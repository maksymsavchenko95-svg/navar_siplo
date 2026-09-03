import type {
  CartContext,
  CartView,
  CartWriteItem,
  CartWriteResult,
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

/**
 * `RetailProvider` — the seam that isolates the product from any single retailer
 * (ADR-04, `RISK-01`). Nothing outside this package speaks to the Silpo MCP; everything
 * else depends on this interface. It grows as features land (cart context, product
 * search, promotions, order history, writes).
 */
export interface RetailProvider {
  /** Connect if needed and return the tool catalogue (or an auth prompt). */
  listTools(): Promise<McpToolsResult>;

  /**
   * Branch + delivery type + a valid timeslot — the prerequisite for catalogue/search
   * calls (rules/mcp-integration "Cart context is a prerequisite"). Throws
   * `NoCartError` if the guest has no cart yet.
   */
  getCartContext(): Promise<CartContext>;

  /** Search the catalogue for each query (batched). Result order matches the input. */
  findProducts(queries: string[]): Promise<ProductSearchResult[]>;

  /**
   * Cart-gated. Composition + nutrition for one SKU (`silpo_get_product_details`). Feeds
   * the SKU-level safety gate (T2.2) and the replacement funnel — not the mapper's
   * scoring path. Throws `NoCartError` / `AuthRequiredError`.
   */
  getProductDetails(slug: string): Promise<ProductDetails>;

  /**
   * Cart-gated. Picking-risk replacement candidates for the given SKUs
   * (`silpo_get_replacements`). `replacements: []` per id is the normal "no known risk"
   * outcome, not an error. Result order matches the input.
   */
  getReplacements(items: { productId: string; companyId: string }[]): Promise<ReplacementResult[]>;

  // ── cart writes (T3.1 / T3.2, ADR-07, FR-CART-*) ──────────────────────────

  /**
   * The whole live cart — lines, totals, `validations[]`, `loyalty`, checkout links, and
   * the delivery echo `updateCartBonus` needs. Throws `NoCartError` if the Guest has no
   * cart (never creates one). `AuthRequiredError` without a token.
   */
  getCart(): Promise<CartView>;

  /**
   * Set absolute quantities for the given SKUs (`silpo_add_or_update_cart_products` with
   * `addQuantity:false`). Idempotent — a retry does not double a line. Never clears the
   * cart. Re-read with `getCart()` afterwards: `success` means accepted, not valid.
   */
  addCartProducts(items: CartWriteItem[]): Promise<CartWriteResult>;

  /** Remove the given SKUs (`silpo_remove_cart_products`). Cleanup / script use only. */
  removeCartProducts(productIds: string[]): Promise<CartWriteResult>;

  /**
   * Apply (`bonusRequested`) or clear (`null`) balabonuses via `silpo_update_shopping_cart`,
   * echoing the cart's delivery/address/shipments. Throws if the cart has no usable
   * delivery context.
   */
  updateCartBonus(bonusRequested: number | null): Promise<CartWriteResult>;
}

/**
 * The read side of `household.bootstrap` (`FR-HH-001..002`, roadmap T1.4). Kept separate
 * from `RetailProvider`'s core seam so the 3-method contract stays small. All results are
 * PII-free — the `silpo/parse.ts` mappers drop names, phones, exact addresses and receipt
 * URLs at the boundary (`INT-LLM-004`). Every method throws `AuthRequiredError` without a
 * token; the two cart-gated methods additionally need a cart (`NoCartError`).
 */
export interface HouseholdReader {
  getProfile(): Promise<RetailProfile>;
  getFamily(): Promise<RetailFamily>;
  getFoodRestrictions(): Promise<RawRestriction[]>;
  getDeliveryAddresses(): Promise<RetailAddress[]>;
  getOnlineOrders(opts?: { limit?: number; offset?: number }): Promise<RetailOrder[]>;
  /** Cart-gated. Throws `NoCartError` if the guest has no cart. */
  getOfflineOrders(opts?: {
    limit?: number;
    offset?: number;
    dateStart?: string;
    dateEnd?: string;
  }): Promise<RetailOrder[]>;
  /** Cart-gated. */
  getFavorites(opts?: { limit?: number; offset?: number }): Promise<RetailFavorite[]>;
}

/** The guest has no Silpo cart yet — search cannot be gated. */
export class NoCartError extends Error {
  constructor() {
    super("No Silpo cart yet — open the Silpo app or site once to create one");
    this.name = "NoCartError";
  }
}

/** No usable MCP credentials for this household — run `mcp:auth`. */
export class AuthRequiredError extends Error {
  constructor(readonly hint = "run `pnpm mcp:auth` (one-time Silpo login)") {
    super(hint);
    this.name = "AuthRequiredError";
  }
}
