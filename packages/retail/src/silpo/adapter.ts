import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CartContext,
  CartView,
  CartWriteItem,
  CartWriteResult,
  CredentialStore,
  McpToolsResult,
  ProductDetails,
  ProductSearchResult,
  RawRestriction,
  ReplacementResult,
  RetailAddress,
  RetailFamily,
  RetailFavorite,
  RetailOrder,
  RetailProfile,
} from "@navar/domain";

import {
  AuthRequiredError,
  type HouseholdReader,
  NoCartError,
  type RetailProvider,
} from "../provider.js";
import { toToolSummaries } from "../summaries.js";
import type { SilpoOAuthClient } from "./app-client.js";
import { isRateLimit } from "./errors.js";
import { SilpoOAuthProvider } from "./oauth.js";
import {
  parseAddresses,
  parseFamily,
  parseFavorites,
  parseOrders,
  parseProfile,
  parseRestrictionsRaw,
  parseToolResult,
  toCartContext,
  toCartView,
  toCartWriteResult,
  toProductDetails,
  toProductSearchResults,
  toReplacementResults,
} from "./parse.js";

export interface SilpoRetailProviderOptions {
  mcpUrl: string;
  store: CredentialStore;
  householdId: string;
  /** Redirect URI registered for this household's OAuth client; unused at runtime once connected. */
  redirectUrl: string;
  /** The shared app-level OAuth client (web flow). See `SilpoOAuthOptions.appClientInformation`. */
  appClientInformation?: () => Promise<SilpoOAuthClient>;
}

const AUTH_HINT = "run `pnpm mcp:auth` (one-time Silpo login)";
const CART_TTL_MS = 60_000;
const PRODUCT_TTL_MS = 5 * 60_000; // prices/stock: never cached beyond 60 min (NFR-DATA-002)
const WRITE_GAP_MS = 6_000; // the server frees a rate-limited cart write after ~6 s

/** Retry `fn` on JSON-RPC 429 with exponential backoff (rules/mcp-integration.md). */
async function withBackoff<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as { code?: number }).code !== 429 || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

/**
 * Retry a cart write past the server's plain-text "Rate limit exceeded" (it is NOT a
 * JSON-RPC 429, so `withBackoff` misses it — M0 audit Block 6). Spaced generously.
 */
async function writeWithRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimit(err) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, WRITE_GAP_MS * i));
    }
  }
}

/**
 * Silpo implementation of `RetailProvider`. Connects lazily; `tools/list` at first use is
 * cached (`INT-MCP-001` — never hardcode tool names). Cart context and product search are
 * cached briefly. Nothing outside this class imports the MCP SDK (ADR-04).
 */
export class SilpoRetailProvider implements RetailProvider, HouseholdReader {
  private client: Client | undefined;
  private toolsCache: McpToolsResult | undefined;
  private cartCache: { at: number; value: CartContext } | undefined;
  private productCache = new Map<string, { at: number; value: ProductSearchResult }>();
  private detailsCache = new Map<string, { at: number; value: ProductDetails }>();

  constructor(private readonly opts: SilpoRetailProviderOptions) {}

  /** Optional warm-up on server boot. Never throws. */
  async init(): Promise<void> {
    try {
      const result = await this.listTools();
      if (result.status === "ok") {
        console.log(`[retail] connected, ${result.tools.length} Silpo MCP tools`);
      } else {
        console.warn(`[retail] not connected — ${result.hint}`);
      }
    } catch (err) {
      console.error("[retail] init failed:", err instanceof Error ? err.message : err);
    }
  }

  async listTools(): Promise<McpToolsResult> {
    if (this.toolsCache) return this.toolsCache;
    if (!(await this.hasToken())) return { status: "auth_required", hint: AUTH_HINT };
    try {
      await this.connect();
      const { tools } = await withBackoff(() => this.client!.listTools());
      this.toolsCache = { status: "ok", tools: toToolSummaries(tools) };
      return this.toolsCache;
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: "auth_required", hint: AUTH_HINT };
      throw new Error(`Silpo MCP error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getCartContext(): Promise<CartContext> {
    if (this.cartCache && Date.now() - this.cartCache.at < CART_TTL_MS) return this.cartCache.value;
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);

    const myCart = await this.callTool("silpo_get_my_shopping_cart");
    const cartId = (myCart as { shoppingCartId?: string }).shoppingCartId;
    const cartById = cartId
      ? await this.callTool("silpo_get_shopping_cart_by_id", { shoppingCartId: cartId })
      : {};
    const branchId = (cartById as { cart?: { shipments?: { branchId?: string }[] } }).cart
      ?.shipments?.[0]?.branchId;
    const deliveryType = (cartById as { cart?: { deliveryType?: string } }).cart?.deliveryType;
    const slots = branchId
      ? await this.callTool("silpo_get_time_slots", {
          branchId,
          deliveryTypes: deliveryType ? [deliveryType] : undefined,
          limit: 10,
        })
      : {};

    const value = toCartContext(myCart as never, cartById as never, slots as never);
    this.cartCache = { at: Date.now(), value };
    return value;
  }

  async findProducts(queries: string[]): Promise<ProductSearchResult[]> {
    const ctx = await this.getCartContext();
    const now = Date.now();

    const fresh = new Map<string, ProductSearchResult>();
    const missing: string[] = [];
    for (const q of queries) {
      const hit = this.productCache.get(`${ctx.branchId}|${q}`);
      if (hit && now - hit.at < PRODUCT_TTL_MS) fresh.set(q, hit.value);
      else if (!missing.includes(q)) missing.push(q);
    }

    if (missing.length > 0) {
      const response = await this.callTool("silpo_find_products_batch", {
        branchId: ctx.branchId,
        deliveryType: ctx.deliveryType,
        timeslotStart: ctx.timeslot.start,
        timeslotEnd: ctx.timeslot.end,
        products: missing.slice(0, 30),
        limit: 5,
      });
      for (const result of toProductSearchResults(response as never, missing)) {
        this.productCache.set(`${ctx.branchId}|${result.query}`, { at: now, value: result });
        fresh.set(result.query, result);
      }
    }

    return queries.map((query) => fresh.get(query) ?? { query, products: [] });
  }

  async getProductDetails(slug: string): Promise<ProductDetails> {
    const ctx = await this.getCartContext(); // throws NoCartError
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);
    const key = `${ctx.branchId}|${slug}`;
    const hit = this.detailsCache.get(key);
    if (hit && Date.now() - hit.at < PRODUCT_TTL_MS) return hit.value;
    const raw = await this.callTool("silpo_get_product_details", {
      branchId: ctx.branchId,
      deliveryType: ctx.deliveryType,
      timeslotStart: ctx.timeslot.start,
      timeslotEnd: ctx.timeslot.end,
      slug,
    });
    const value = toProductDetails(raw);
    this.detailsCache.set(key, { at: Date.now(), value });
    return value;
  }

  async getReplacements(
    items: { productId: string; companyId: string }[],
  ): Promise<ReplacementResult[]> {
    if (items.length === 0) return [];
    const ctx = await this.getCartContext();
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);
    const companyId = items[0]!.companyId; // one branch → one company
    const productIds = items.map((i) => i.productId);
    const raw = await this.callTool("silpo_get_replacements", {
      branchId: ctx.branchId,
      companyId,
      deliveryType: ctx.deliveryType,
      productIds,
    });
    return toReplacementResults(raw, productIds);
  }

  // ─── Cart writes (RetailProvider, T3.1 / T3.2) ──────────────────────────────

  async getCart(): Promise<CartView> {
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);
    const myCart = (await this.callTool("silpo_get_my_shopping_cart")) as {
      shoppingCartId?: string;
      exists?: boolean;
    };
    const cartById =
      myCart.shoppingCartId && myCart.exists !== false
        ? await this.callTool("silpo_get_shopping_cart_by_id", {
            shoppingCartId: myCart.shoppingCartId,
          })
        : {};
    return toCartView(myCart, cartById); // throws NoCartError when there is no cart
  }

  async addCartProducts(items: CartWriteItem[]): Promise<CartWriteResult> {
    if (items.length === 0) return { success: true, summary: "nothing to add", products: [] };
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);
    const shoppingCartId = await this.myShoppingCartId();
    const raw = await writeWithRetry(() =>
      this.callTool("silpo_add_or_update_cart_products", {
        shoppingCartId,
        products: items.map((it) => ({
          productId: it.productId,
          companyId: it.companyId,
          branchId: it.branchId,
          quantity: it.quantity,
          addQuantity: false, // set semantics → a retry cannot double a line (NFR-REL-003)
        })),
      }),
    );
    this.clearCartCache();
    return toCartWriteResult(raw);
  }

  async removeCartProducts(productIds: string[]): Promise<CartWriteResult> {
    if (productIds.length === 0)
      return { success: true, summary: "nothing to remove", products: [] };
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);
    const shoppingCartId = await this.myShoppingCartId();
    const raw = await writeWithRetry(() =>
      this.callTool("silpo_remove_cart_products", {
        shoppingCartId,
        products: productIds.map((productId) => ({ productId })),
      }),
    );
    this.clearCartCache();
    return toCartWriteResult(raw);
  }

  async updateCartBonus(bonusRequested: number | null): Promise<CartWriteResult> {
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);
    const cart = await this.getCart();
    if (!cart.delivery) {
      throw new Error("cart has no usable delivery context — cannot apply balabonuses");
    }
    const raw = await writeWithRetry(() =>
      this.callTool("silpo_update_shopping_cart", {
        shoppingCartId: cart.shoppingCartId,
        deliveryType: cart.delivery!.deliveryType,
        timeslot: cart.delivery!.timeslot,
        address: cart.delivery!.address,
        shipments: cart.delivery!.shipments,
        bonusRequested,
      }),
    );
    this.clearCartCache();
    return toCartWriteResult(raw);
  }

  private async myShoppingCartId(): Promise<string> {
    const myCart = (await this.callTool("silpo_get_my_shopping_cart")) as {
      shoppingCartId?: string;
      exists?: boolean;
    };
    if (!myCart.shoppingCartId || myCart.exists === false) throw new NoCartError();
    return myCart.shoppingCartId;
  }

  private clearCartCache(): void {
    this.cartCache = undefined;
  }

  // ─── Household reads (HouseholdReader, T1.4) ────────────────────────────────

  async getProfile(): Promise<RetailProfile> {
    return parseProfile(await this.callToolAuthed("silpo_get_my_profile"));
  }

  async getFamily(): Promise<RetailFamily> {
    return parseFamily(await this.callToolAuthed("silpo_get_my_family"));
  }

  async getFoodRestrictions(): Promise<RawRestriction[]> {
    return parseRestrictionsRaw(await this.callToolAuthed("silpo_get_my_food_restrictions"));
  }

  async getDeliveryAddresses(): Promise<RetailAddress[]> {
    return parseAddresses(await this.callToolAuthed("silpo_get_my_delivery_addresses"));
  }

  /** Live MCP caps `limit` at 50 (the committed snapshot still says 100 — docs lag reality). */
  async getOnlineOrders(opts: { limit?: number; offset?: number } = {}): Promise<RetailOrder[]> {
    const raw = await this.callToolAuthed("silpo_get_my_online_orders", {
      limit: Math.min(opts.limit ?? 50, 50),
      offset: opts.offset ?? 0,
    });
    return parseOrders(raw);
  }

  async getOfflineOrders(
    opts: { limit?: number; offset?: number; dateStart?: string; dateEnd?: string } = {},
  ): Promise<RetailOrder[]> {
    const ctx = await this.getCartContext(); // throws NoCartError if no cart
    const raw = await this.callToolAuthed("silpo_get_my_offline_orders", {
      branchId: ctx.branchId,
      deliveryType: ctx.deliveryType,
      timeslotStart: ctx.timeslot.start,
      timeslotEnd: ctx.timeslot.end,
      limit: Math.min(opts.limit ?? 10, 10),
      offset: opts.offset ?? 0,
      ...(opts.dateStart ? { dateStart: opts.dateStart } : {}),
      ...(opts.dateEnd ? { dateEnd: opts.dateEnd } : {}),
    });
    return parseOrders(raw);
  }

  async getFavorites(opts: { limit?: number; offset?: number } = {}): Promise<RetailFavorite[]> {
    const ctx = await this.getCartContext();
    const raw = await this.callToolAuthed("silpo_get_my_favorites", {
      branchId: ctx.branchId,
      deliveryType: ctx.deliveryType,
      timeslotStart: ctx.timeslot.start,
      limit: Math.min(opts.limit ?? 25, 500),
      offset: opts.offset ?? 0,
    });
    return parseFavorites(raw);
  }

  /** `callTool` guarded by a token check — the household reads all require auth. */
  private async callToolAuthed(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!(await this.hasToken())) throw new AuthRequiredError(AUTH_HINT);
    return this.callTool(name, args);
  }

  /**
   * Raw `tools/list` response, full schemas, uncached. For the committed contract
   * snapshot (`pnpm mcp:tools-snapshot`, audit checklist Block 0) — not a runtime path.
   */
  async rawToolList(): Promise<unknown> {
    await this.connect();
    return withBackoff(() => this.client!.listTools());
  }

  /**
   * Call an arbitrary tool and return its parsed payload, uncached. For the manual MCP
   * audit (`pnpm mcp:audit`, audit checklist Blocks 1–7) — not a runtime path; product
   * code uses the typed methods above so the `parse.ts` mappers stay the single seam.
   */
  async callToolRaw(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.callTool(name, args);
  }

  private async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    try {
      await this.connect();
      const result = await withBackoff(() => this.client!.callTool({ name, arguments: args }));
      if ((result as { isError?: boolean }).isError) {
        throw new Error(`${name}: ${JSON.stringify(parseToolResult(result))}`);
      }
      return parseToolResult(result);
    } catch (err) {
      if (err instanceof UnauthorizedError) throw new AuthRequiredError(AUTH_HINT);
      throw err;
    }
  }

  private async hasToken(): Promise<boolean> {
    const stored = await this.opts.store.load(this.opts.householdId);
    return Boolean(stored?.tokens?.access_token);
  }

  private async connect(): Promise<void> {
    if (this.client) return;
    const client = new Client({ name: "navar", version: "0.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(this.opts.mcpUrl), {
      authProvider: new SilpoOAuthProvider({
        store: this.opts.store,
        householdId: this.opts.householdId,
        redirectUrl: this.opts.redirectUrl,
        appClientInformation: this.opts.appClientInformation,
      }),
    });
    await client.connect(transport);
    this.client = client;
  }
}
