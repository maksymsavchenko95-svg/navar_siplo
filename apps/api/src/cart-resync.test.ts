import type { CartView, ListLine } from "@navar/domain";
import { AuthRequiredError, NoCartError, type RetailProvider } from "@navar/retail";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markPlanMaterialized = vi.fn(async () => 1);
vi.mock("@navar/db", () => ({
  markPlanMaterialized: (...a: unknown[]) => markPlanMaterialized(...(a as [])),
  // pulled in transitively by ./cart.js — never called here
  getPlanDetail: vi.fn(),
  getPlanLineDays: vi.fn(async () => new Map()),
}));
vi.mock("./mapper.js", () => ({ loadMapperDict: vi.fn(async () => new Map()) }));
vi.mock("./mcp-trace.js", () => ({
  withPersistedMcpTrace: (_p: string, _i: unknown, fn: () => unknown) => fn(),
}));
const redis = new Map<string, string>();
vi.mock("./queue/connection.js", () => ({
  connection: {
    get: async (k: string) => redis.get(k) ?? null,
    set: async () => undefined,
    keys: async () => [],
    del: async () => undefined,
  },
}));

const { diffCartLines, applyCartDelta } = await import("./cart-resync.js");

const line = (over: Partial<ListLine> & Pick<ListLine, "slug">): ListLine => ({
  ingredientId: `id-${over.slug}`,
  nameUk: over.slug,
  neededAmount: 300,
  unit: "g",
  productRef: `${over.slug}-sku`,
  externalProductId: null,
  companyId: "co",
  branchId: "br",
  productName: `${over.slug} SKU`,
  packSize: 400,
  packCount: 1,
  quantityKg: null,
  price: 40,
  oldPrice: null,
  isPromo: false,
  confidence: 0.9,
  decision: "accepted",
  needsConfirmation: false,
  outOfStock: false,
  blockReason: null,
  replacedFromName: null,
  userOverridden: false,
  ...over,
});

const cartView = (over: Partial<CartView> = {}): CartView => ({
  shoppingCartId: "cart-9",
  lines: [],
  totalUah: 500,
  totalAfterDiscountsUah: 480,
  validations: [],
  loyalty: null,
  checkoutWebLink: "https://silpo.ua/c",
  checkoutMobileLink: null,
  delivery: null,
  ...over,
});

function fakeRetail(over: Partial<Record<string, unknown>> = {}) {
  const m = {
    getCart: vi.fn(async () => cartView()),
    addCartProducts: vi.fn(async () => ({ success: true, summary: "ok", products: [] })),
    removeCartProducts: vi.fn(async () => ({ success: true, summary: "ok", products: [] })),
    ...over,
  };
  return m as unknown as typeof m & RetailProvider;
}

beforeEach(() => vi.clearAllMocks());

describe("diffCartLines", () => {
  it("removes a dropped SKU, adds a new line, re-asserts a changed quantity, skips an unchanged one", () => {
    const prev = [
      line({ slug: "beef", productRef: "beef-1", packCount: 1 }),
      line({ slug: "rice", productRef: "rice-1", packCount: 2 }),
      line({ slug: "salt", productRef: "salt-1", packCount: 1 }),
    ];
    const next = [
      line({ slug: "rice", productRef: "rice-1", packCount: 3 }), // quantity changed
      line({ slug: "salt", productRef: "salt-1", packCount: 1 }), // unchanged
      line({ slug: "peas", productRef: "peas-1", packCount: 1 }), // new
      // beef dropped
    ];
    const delta = diffCartLines(prev, next);
    expect(delta.removeProductIds).toEqual(["beef-1"]);
    expect(delta.addItems.map((i) => i.productId).sort()).toEqual(["peas-1", "rice-1"]);
  });

  it("removes the SKU of a line that turned unsafe / out of stock in the new list", () => {
    const prev = [line({ slug: "beef", productRef: "beef-1" })];
    const next = [line({ slug: "beef", productRef: "beef-1", blockReason: "алерген: молоко" })];
    const delta = diffCartLines(prev, next);
    expect(delta.removeProductIds).toEqual(["beef-1"]);
    expect(delta.addItems).toEqual([]);
  });
});

describe("applyCartDelta", () => {
  it("removes then adds then re-reads, and refreshes the plan's cart id", async () => {
    const retail = fakeRetail();
    const r = await applyCartDelta("p1", "hh", retail, {
      removeProductIds: ["gone"],
      addItems: [{ productId: "new", companyId: "co", branchId: "br", quantity: 2 }],
    });
    expect(retail.removeCartProducts).toHaveBeenCalledWith(["gone"]);
    expect(retail.addCartProducts).toHaveBeenCalledWith([
      { productId: "new", companyId: "co", branchId: "br", quantity: 2 },
    ]);
    expect(retail.getCart).toHaveBeenCalled();
    expect(markPlanMaterialized).toHaveBeenCalledWith("p1", "hh", "cart-9");
    expect(r).toMatchObject({
      status: "ok",
      cartTotalUah: 480,
      checkoutWebLink: "https://silpo.ua/c",
    });
  });

  it("skips empty remove/add calls but still re-reads", async () => {
    const retail = fakeRetail();
    await applyCartDelta("p1", "hh", retail, { removeProductIds: [], addItems: [] });
    expect(retail.removeCartProducts).not.toHaveBeenCalled();
    expect(retail.addCartProducts).not.toHaveBeenCalled();
    expect(retail.getCart).toHaveBeenCalled();
  });

  it("maps retail failures to auth_required / no_cart / error", async () => {
    const auth = fakeRetail({
      getCart: vi.fn(async () => {
        throw new AuthRequiredError("reconnect");
      }),
    });
    expect(
      (await applyCartDelta("p1", "hh", auth, { removeProductIds: [], addItems: [] })).status,
    ).toBe("auth_required");
    const noCart = fakeRetail({
      addCartProducts: vi.fn(async () => {
        throw new NoCartError();
      }),
    });
    expect(
      (
        await applyCartDelta("p1", "hh", noCart, {
          removeProductIds: [],
          addItems: [{ productId: "x", companyId: "co", branchId: "br", quantity: 1 }],
        })
      ).status,
    ).toBe("no_cart");
  });
});
