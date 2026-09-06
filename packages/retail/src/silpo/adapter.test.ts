import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthRequiredError } from "../provider.js";
import { runWithMcpTrace } from "../trace.js";
import { SilpoRetailProvider } from "./adapter.js";

/** A provider with a stubbed MCP client so `connect()` short-circuits (no network). */
function providerWith(
  clientCallTool: (args: { name: string; arguments: unknown }) => unknown,
  opts: { withToken?: boolean } = {},
) {
  const provider = new SilpoRetailProvider({
    mcpUrl: "https://mcp.example/mcp",
    store: {
      load: async () => (opts.withToken ? { tokens: { access_token: "x" } } : undefined),
      save: async () => {},
      clear: async () => {},
    } as never,
    householdId: "hh-1",
    redirectUrl: "http://localhost:0/callback",
  });
  (provider as unknown as { client: unknown }).client = { callTool: vi.fn(clientCallTool) };
  return provider;
}

/** MCP text envelope for a JSON payload. */
const env = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

/** A stub that answers the cart-context dance + a named tool. */
function cartAwareStub(named: Record<string, unknown>) {
  return ({ name }: { name: string }) => {
    if (name === "silpo_get_my_shopping_cart") return env({ exists: true, shoppingCartId: "c1" });
    if (name === "silpo_get_shopping_cart_by_id")
      return env({ cart: { deliveryType: "DeliveryHome", shipments: [{ branchId: "b1" }] } });
    if (name === "silpo_get_time_slots")
      return env({
        slots: [{ start: "2026-09-02T10:00:00Z", end: "2026-09-02T12:00:00Z", available: true }],
      });
    if (name in named) return env(named[name]);
    return env({});
  };
}

describe("SilpoRetailProvider.callToolRaw", () => {
  it("forwards name + args to the client and returns the parsed JSON payload", async () => {
    const spy = vi.fn(() => ({ content: [{ type: "text", text: '{"orders":[1,2,3]}' }] }));
    const provider = providerWith(spy);

    const out = await provider.callToolRaw("silpo_get_my_offline_orders", { limit: 10, offset: 0 });

    expect(out).toEqual({ orders: [1, 2, 3] });
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_my_offline_orders",
      arguments: { limit: 10, offset: 0 },
    });
  });

  it("defaults args to an empty object", async () => {
    const spy = vi.fn(() => ({ content: [{ type: "text", text: "{}" }] }));
    await providerWith(spy).callToolRaw("silpo_get_loyalty_info");
    expect(spy).toHaveBeenCalledWith({ name: "silpo_get_loyalty_info", arguments: {} });
  });

  it("throws when the tool result is an error", async () => {
    const provider = providerWith(() => ({
      isError: true,
      content: [{ type: "text", text: '{"_raw":"Rate limit exceeded"}' }],
    }));
    await expect(provider.callToolRaw("silpo_add_or_update_cart_products")).rejects.toThrow(
      /Rate limit exceeded/,
    );
  });

  it("maps an SDK UnauthorizedError to AuthRequiredError", async () => {
    const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const provider = providerWith(() => {
      throw new UnauthorizedError("nope");
    });
    await expect(provider.callToolRaw("silpo_get_my_profile")).rejects.toBeInstanceOf(
      AuthRequiredError,
    );
  });
});

describe("SilpoRetailProvider household reads", () => {
  it("getProfile drops PII and derives the birth year", async () => {
    const provider = providerWith(
      cartAwareStub({
        silpo_get_my_profile: {
          profile: {
            id: "p-uuid",
            firstName: "Тарас",
            phone: "+380",
            birthday: "1990-04-01",
            gender: "male",
            status: "Active",
          },
        },
      }),
      { withToken: true },
    );
    expect(await provider.getProfile()).toEqual({
      silpoProfileId: "p-uuid",
      gender: "male",
      birthYear: 1990,
    });
  });

  it("getFamily counts adults/pets and maps child ages", async () => {
    const now = new Date("2026-09-02T00:00:00Z");
    const provider = providerWith(
      cartAwareStub({
        silpo_get_my_family: {
          members: [
            { profileId: "a", itsMe: true, name: "X", phone: "1" },
            { profileId: "b", name: "Y" },
          ],
          children: [{ id: "c", name: "Z", dateOfBirth: "2018-01-01" }],
          pets: [{ id: "d" }],
        },
      }),
      { withToken: true },
    );
    const fam = await provider.getFamily();
    // parseFamily uses `new Date()` internally; assert the structural bits.
    expect(fam.adultCount).toBe(2);
    expect(fam.petCount).toBe(1);
    expect(fam.itsMeProfileId).toBe("a");
    expect(fam.childAgeYears).toHaveLength(1);
    void now;
  });

  it("getDeliveryAddresses keeps only id/tag/city", async () => {
    const provider = providerWith(
      cartAwareStub({
        silpo_get_my_delivery_addresses: {
          addresses: [
            { id: "a1", tag: null, city: "Київ", street: "s", building: "b", floor: "8" },
          ],
        },
      }),
      { withToken: true },
    );
    expect(await provider.getDeliveryAddresses()).toEqual([{ id: "a1", tag: null, city: "Київ" }]);
  });

  it("getOnlineOrders passes limit/offset and maps lines", async () => {
    const spy = vi.fn(
      cartAwareStub({
        silpo_get_my_online_orders: {
          orders: [
            {
              orderId: "o1",
              createdAt: "2026-02-02T12:07:14+00:00",
              amount: 100,
              discount: 5,
              products: [{ id: "x", name: "Хліб", price: 20, quantity: 2, subtotal: 40 }],
            },
          ],
        },
      }),
    );
    const provider = providerWith(spy, { withToken: true });
    const orders = await provider.getOnlineOrders({ limit: 50 });
    expect(orders[0]).toMatchObject({ source: "online", externalId: "o1", total: 100 });
    expect(orders[0]!.lines[0]).toMatchObject({ key: "name:Хліб", lineTotal: 40 });
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_my_online_orders",
      arguments: { limit: 50, offset: 0 },
    });
  });

  it("getOnlineOrders clamps limit to the live MCP max of 50", async () => {
    const spy = vi.fn(cartAwareStub({ silpo_get_my_online_orders: { orders: [] } }));
    const provider = providerWith(spy, { withToken: true });
    await provider.getOnlineOrders({ limit: 100 });
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_my_online_orders",
      arguments: { limit: 50, offset: 0 },
    });
  });

  it("getOfflineOrders is cart-gated — passes branch/delivery/timeslot", async () => {
    const spy = vi.fn(
      cartAwareStub({
        silpo_get_my_offline_orders: {
          orders: [
            {
              filId: 42,
              createdAt: "2026-08-17T20:11:07",
              sumReg: 479.55,
              sumDiscount: 81,
              products: [
                {
                  lagerId: 1,
                  name: "Персик",
                  unit: "кг",
                  quantity: 0.6,
                  price: 90,
                  catalogProduct: { id: "cp", slug: "persyk-1" },
                },
                {
                  lagerId: 2,
                  name: "Void",
                  unit: "шт",
                  quantity: -1,
                  price: 10,
                  catalogProduct: null,
                },
              ],
            },
          ],
        },
      }),
    );
    const provider = providerWith(spy, { withToken: true });
    const orders = await provider.getOfflineOrders();
    expect(orders[0]).toMatchObject({ source: "offline", total: 479.55 });
    expect(orders[0]!.createdAt).toBe("2026-08-17T20:11:07.000Z"); // naive → UTC
    expect(orders[0]!.lines[0]).toMatchObject({ key: "persyk-1", slug: "persyk-1" });
    expect(orders[0]!.lines[1]).toMatchObject({ key: "lager:2", slug: null, quantity: -1 });
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_my_offline_orders",
      arguments: {
        branchId: "b1",
        deliveryType: "DeliveryHome",
        timeslotStart: "2026-09-02T10:00:00Z",
        timeslotEnd: "2026-09-02T12:00:00Z",
        limit: 10,
        offset: 0,
      },
    });
  });

  it("household reads throw AuthRequiredError without a token", async () => {
    const provider = providerWith(cartAwareStub({}), { withToken: false });
    await expect(provider.getProfile()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("getFavorites propagates NoCartError when there is no cart", async () => {
    const { NoCartError } = await import("../provider.js");
    const provider = providerWith(
      ({ name }) =>
        name === "silpo_get_my_shopping_cart"
          ? { content: [{ type: "text", text: JSON.stringify({ exists: false }) }] }
          : { content: [{ type: "text", text: "{}" }] },
      { withToken: true },
    );
    await expect(provider.getFavorites()).rejects.toBeInstanceOf(NoCartError);
  });
});

describe("SilpoRetailProvider.getProductDetails / getReplacements", () => {
  it("getProductDetails is cart-gated and passes branch/delivery/timeslot/slug", async () => {
    const spy = vi.fn(
      cartAwareStub({
        silpo_get_product_details: {
          product: {
            slug: "hard-cheese-1",
            name: "Сир твердий",
            price: 120,
            stock: 4,
            available: true,
            attributes: { "Білки (г)": 25, "Енергетична цінність (кКал/кДЖ)": "364/1520" },
          },
        },
      }),
    );
    const provider = providerWith(spy, { withToken: true });
    const d = await provider.getProductDetails("hard-cheese-1");
    expect(d).toMatchObject({ slug: "hard-cheese-1", protein100: 25, kcal100: 364 });
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_product_details",
      arguments: {
        branchId: "b1",
        deliveryType: "DeliveryHome",
        timeslotStart: "2026-09-02T10:00:00Z",
        timeslotEnd: "2026-09-02T12:00:00Z",
        slug: "hard-cheese-1",
      },
    });
  });

  it("getProductDetails throws AuthRequiredError without a token", async () => {
    const provider = providerWith(cartAwareStub({}), { withToken: false });
    await expect(provider.getProductDetails("x")).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("getReplacements takes companyId from the first item and aligns to input order", async () => {
    const spy = vi.fn(
      cartAwareStub({
        silpo_get_replacements: {
          items: [
            {
              productId: "p2",
              replacements: [
                { id: "r1", name: "Замінник", slug: "r-1", price: 30, available: true, stock: 2 },
              ],
            },
          ],
        },
      }),
    );
    const provider = providerWith(spy, { withToken: true });
    const out = await provider.getReplacements([
      { productId: "p1", companyId: "co-1" },
      { productId: "p2", companyId: "co-1" },
    ]);
    expect(out.map((r) => r.productId)).toEqual(["p1", "p2"]);
    expect(out[1]!.replacements[0]).toMatchObject({ slug: "r-1" });
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_replacements",
      arguments: {
        branchId: "b1",
        companyId: "co-1",
        deliveryType: "DeliveryHome",
        productIds: ["p1", "p2"],
      },
    });
  });

  it("getReplacements returns [] without calling the tool for an empty input", async () => {
    const spy = vi.fn(cartAwareStub({}));
    const provider = providerWith(spy, { withToken: true });
    expect(await provider.getReplacements([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SilpoRetailProvider cart writes (T3.1 / T3.2)", () => {
  const cartByIdPayload = {
    cart: {
      deliveryType: "DeliveryHome",
      timeslot: { start: "2026-09-04T10:00:00Z", end: "2026-09-04T12:00:00Z" },
      address: { addressType: "home", latitude: "50", longitude: "30" },
      shipments: [{ companyId: "co-1", branchId: "br-1", products: [] }],
      calculation: { total: 850, totalAfterDiscounts: 820, validations: [] },
    },
    loyalty: { bonusAvailable: 30, bonusTotal: 30, bonusRequested: null, isEnabled: true },
    checkoutWebLink: "https://silpo.ua/checkout",
  };

  function cartWriteStub(named: Record<string, unknown> = {}) {
    return ({ name }: { name: string }) => {
      if (name === "silpo_get_my_shopping_cart")
        return env({ exists: true, shoppingCartId: "cart-1" });
      if (name === "silpo_get_shopping_cart_by_id") return env(cartByIdPayload);
      if (name in named) return env(named[name]);
      return env({ success: true, summary: "ok", products: [] });
    };
  }

  it("getCart parses lines/validations/loyalty/links and the delivery echo", async () => {
    const provider = providerWith(cartWriteStub(), { withToken: true });
    const cart = await provider.getCart();
    expect(cart.shoppingCartId).toBe("cart-1");
    expect(cart.totalAfterDiscountsUah).toBe(820);
    expect(cart.loyalty).toMatchObject({ bonusAvailable: 30, isEnabled: true });
    expect(cart.checkoutWebLink).toBe("https://silpo.ua/checkout");
    expect(cart.delivery).toMatchObject({ deliveryType: "DeliveryHome" });
  });

  it("getCart throws NoCartError when the Guest has no cart", async () => {
    const { NoCartError } = await import("../provider.js");
    const provider = providerWith(
      ({ name }) => (name === "silpo_get_my_shopping_cart" ? env({ exists: false }) : env({})),
      { withToken: true },
    );
    await expect(provider.getCart()).rejects.toBeInstanceOf(NoCartError);
  });

  it("addCartProducts sends addQuantity:false and the three ids per item", async () => {
    const spy = vi.fn(cartWriteStub());
    const provider = providerWith(spy, { withToken: true });
    await provider.addCartProducts([
      { productId: "p1", companyId: "c1", branchId: "b1", quantity: 2 },
    ]);
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_add_or_update_cart_products",
      arguments: {
        shoppingCartId: "cart-1",
        products: [
          { productId: "p1", companyId: "c1", branchId: "b1", quantity: 2, addQuantity: false },
        ],
      },
    });
  });

  it("addCartProducts is a no-op for an empty item list", async () => {
    const spy = vi.fn(cartWriteStub());
    const provider = providerWith(spy, { withToken: true });
    const r = await provider.addCartProducts([]);
    expect(r).toEqual({ success: true, summary: "nothing to add", products: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("retries a write past the plain-text rate limit, then succeeds", async () => {
    let calls = 0;
    const provider = providerWith(
      ({ name }) => {
        if (name === "silpo_get_my_shopping_cart")
          return env({ exists: true, shoppingCartId: "cart-1" });
        if (name === "silpo_add_or_update_cart_products") {
          calls++;
          if (calls === 1)
            return { isError: true, content: [{ type: "text", text: "Rate limit exceeded" }] };
          return env({ success: true, summary: "Updated 1 product(s)", products: [] });
        }
        return env({});
      },
      { withToken: true },
    );
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      fn();
      return 0;
    });
    const r = await provider.addCartProducts([
      { productId: "p1", companyId: "c1", branchId: "b1", quantity: 1 },
    ]);
    expect(calls).toBe(2);
    expect(r.success).toBe(true);
    vi.unstubAllGlobals();
  });

  it("removeCartProducts sends { productId } per id", async () => {
    const spy = vi.fn(cartWriteStub());
    const provider = providerWith(spy, { withToken: true });
    await provider.removeCartProducts(["p1", "p2"]);
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_remove_cart_products",
      arguments: { shoppingCartId: "cart-1", products: [{ productId: "p1" }, { productId: "p2" }] },
    });
  });

  it("updateCartBonus echoes the cart's delivery fields + bonusRequested", async () => {
    const spy = vi.fn(cartWriteStub());
    const provider = providerWith(spy, { withToken: true });
    await provider.updateCartBonus(30);
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_update_shopping_cart",
      arguments: {
        shoppingCartId: "cart-1",
        deliveryType: "DeliveryHome",
        timeslot: { start: "2026-09-04T10:00:00Z", end: "2026-09-04T12:00:00Z" },
        address: { addressType: "home", latitude: "50", longitude: "30" },
        shipments: [{ companyId: "co-1", branchId: "br-1" }],
        bonusRequested: 30,
      },
    });
  });

  it("cart writes throw AuthRequiredError without a token", async () => {
    const provider = providerWith(cartWriteStub(), { withToken: false });
    await expect(
      provider.addCartProducts([{ productId: "p", companyId: "c", branchId: "b", quantity: 1 }]),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

// ─── Promotions (T4.1, FR-PLAN-004) ─────────────────────────────────────────

describe("getPromotions", () => {
  it("passes branch, delivery type and both timeslot bounds from cart context", async () => {
    const spy = vi.fn(
      cartAwareStub({
        silpo_get_promotions: {
          promotions: [{ code: "cinotyzhyky", title: "Цінотижики", productCount: 517, url: "u" }],
        },
      }),
    );
    const provider = providerWith(spy, { withToken: true });

    expect(await provider.getPromotions()).toEqual([
      { code: "cinotyzhyky", title: "Цінотижики", productCount: 517, url: "u" },
    ]);
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_promotions",
      arguments: {
        branchId: "b1",
        deliveryType: "DeliveryHome",
        timeslotStart: "2026-09-02T10:00:00Z",
        timeslotEnd: "2026-09-02T12:00:00Z",
      },
    });
  });

  it("caches per branch — a second call does not hit the MCP again", async () => {
    const spy = vi.fn(cartAwareStub({ silpo_get_promotions: { promotions: [] } }));
    const provider = providerWith(spy, { withToken: true });

    await provider.getPromotions();
    await provider.getPromotions();

    expect(spy.mock.calls.filter((c) => c[0].name === "silpo_get_promotions")).toHaveLength(1);
  });

  it("requires a token", async () => {
    const provider = providerWith(cartAwareStub({}), { withToken: false });
    await expect(provider.getPromotions()).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

describe("getMyPromos", () => {
  it("sends no arguments and needs no cart context", async () => {
    const spy = vi.fn(
      cartAwareStub({
        silpo_get_my_promos: {
          promos: [
            {
              promoId: 42,
              selected: true,
              beginDate: "2026-08-26",
              endDate: "2026-09-01",
              description: "Купуй та заощаджуй",
              rewardText: "x35 балобонусів",
              rewardValue: 35,
              limitText: null,
            },
          ],
        },
      }),
    );
    const provider = providerWith(spy, { withToken: true });

    expect(await provider.getMyPromos()).toEqual([
      {
        promoId: 42,
        selected: true,
        beginDate: "2026-08-26",
        endDate: "2026-09-01",
        description: "Купуй та заощаджуй",
        rewardText: "x35 балобонусів",
        rewardValue: 35,
        limitText: null,
      },
    ]);
    expect(spy).toHaveBeenCalledWith({ name: "silpo_get_my_promos", arguments: {} });
    // No cart context needed — the three cart calls must not have fired.
    expect(spy.mock.calls.map((c) => c[0].name)).not.toContain("silpo_get_my_shopping_cart");
  });

  it("requires a token", async () => {
    const provider = providerWith(cartAwareStub({}), { withToken: false });
    await expect(provider.getMyPromos()).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

// ─── MCP call trace (T4.3, FR-OPS-001) ──────────────────────────────────────

describe("callTool tracing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records one ok entry per logical call, with a byte count", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = providerWith(cartAwareStub({ silpo_get_my_online_orders: { orders: [] } }), {
      withToken: true,
    });

    const { records } = await runWithMcpTrace({ phase: "bootstrap" }, () =>
      provider.getOnlineOrders({ limit: 10, offset: 0 }),
    );

    const orders = records.find((r) => r.tool === "silpo_get_my_online_orders");
    expect(orders).toMatchObject({ status: "ok", attempts: 1, phase: "bootstrap" });
    expect(orders!.resultBytes).toBeGreaterThan(0);
  });

  it("records an error entry with the error code and rethrows", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = providerWith(
      () => {
        throw Object.assign(new Error("boom"), { code: "500" });
      },
      { withToken: true },
    );

    const run = runWithMcpTrace({ phase: "plan_generate" }, async () => {
      await expect(
        provider.callToolRaw("silpo_get_product_details", { slug: "x" }),
      ).rejects.toThrow("boom");
    });
    const { records } = await run;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      tool: "silpo_get_product_details",
      status: "error",
      errorCode: "500",
      resultBytes: null,
    });
  });

  it("records a cache hit (attempts 0, cached) instead of a call on the second read", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = providerWith(cartAwareStub({ silpo_get_promotions: { promotions: [] } }), {
      withToken: true,
    });

    await provider.getPromotions(); // warm
    const { records } = await runWithMcpTrace({ phase: "plan_generate" }, () =>
      provider.getPromotions(),
    );

    const promo = records.find((r) => r.tool === "silpo_get_promotions");
    expect(promo).toMatchObject({ cached: true, attempts: 0, durationMs: 0 });
    // the cart-context dance is cached too
    expect(records.every((r) => r.cached)).toBe(true);
  });

  it("folds 429 retries into a single entry with attempts > 1", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      fn();
      return 0;
    });
    let calls = 0;
    const provider = providerWith(
      () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error("rate"), { code: 429 });
        return { content: [{ type: "text", text: '{"ok":true}' }] };
      },
      { withToken: true },
    );

    const { records } = await runWithMcpTrace({ phase: "cart_materialize" }, () =>
      provider.callToolRaw("silpo_add_or_update_cart_products", {}),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "ok", attempts: 2 });
    vi.unstubAllGlobals();
  });
});
