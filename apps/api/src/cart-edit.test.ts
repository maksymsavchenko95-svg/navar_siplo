import type { ListLineSkuPatch } from "@navar/db";
import type { PlanDetail, ProductMatch } from "@navar/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlanDetail = vi.fn<(id: string, hh: string) => Promise<PlanDetail | null>>();
const updateListLineSku =
  vi.fn<(id: string, hh: string, slug: string, patch: ListLineSkuPatch) => Promise<number>>();
const updateListLineQuantity = vi.fn(async () => 1);
vi.mock("@navar/db", () => ({
  getPlanDetail: (...a: [string, string]) => getPlanDetail(...a),
  updateListLineSku: (...a: [string, string, string, ListLineSkuPatch]) => updateListLineSku(...a),
  updateListLineQuantity: (...a: unknown[]) => updateListLineQuantity(...(a as [])),
}));

/** `applyCartDelta` is exercised in cart-resync.test.ts — here it is a controllable stub. */
const applyCartDelta = vi.fn(async () => ({
  status: "ok" as const,
  validations: [],
  checkoutWebLink: null,
  checkoutMobileLink: null,
  cartTotalUah: 123,
}));
vi.mock("./cart-resync.js", () => ({
  applyCartDelta: (...a: unknown[]) => applyCartDelta(...(a as [])),
}));

const loadMapperDict = vi.fn(
  async () =>
    new Map([
      [
        "beef",
        {
          slug: "beef",
          nameUk: "Яловичина",
          category: "meat" as const,
          baseUnit: "g" as const,
          densityGMl: null,
          gramsPerPiece: null,
          synonyms: ["яловичина"],
          allergens: [] as string[],
        },
      ],
    ]),
);
let skuBlocked = false;
vi.mock("./mapper.js", () => ({
  loadMapperDict: (...a: unknown[]) => loadMapperDict(...(a as [])),
  loadExclusions: async () => ({ allergens: ["gluten"], ingredients: [], strictMode: false }),
  makeSkuSafety: () => async (args: { chosen: ProductMatch }) => ({
    blocked: skuBlocked && args.chosen.productId === "blocked",
    reason: "test block",
  }),
}));
vi.mock("@navar/safety", () => ({ hasHardExclusion: () => true }));

const clearPreview = vi.fn(async () => {});
vi.mock("./cart.js", () => ({ clearPreview: (...a: unknown[]) => clearPreview(...(a as [])) }));
vi.mock("./mcp-trace.js", () => ({
  withPersistedMcpTrace: (_p: string, _i: unknown, fn: () => unknown) => fn(),
}));

const { lineAlternatives, reduceLine, setLineSku } = await import("./cart-edit.js");

// ── fixtures ────────────────────────────────────────────────────────────────

const sku = (
  over: Partial<ProductMatch> & Pick<ProductMatch, "productId" | "name">,
): ProductMatch => ({
  externalProductId: null,
  companyId: "co",
  branchId: "br",
  slug: over.productId,
  price: 200,
  oldPrice: null,
  packSize: "1кг",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  specialPrices: [],
  ...over,
});

const plan = (over: Partial<PlanDetail> = {}): PlanDetail =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    status: "draft",
    cartId: null,
    list: [
      {
        slug: "beef",
        nameUk: "Яловичина",
        neededAmount: 500,
        unit: "g",
        productRef: "current",
        companyId: "co",
        productName: "Яловичина тушкована",
        packCount: 1,
      },
    ],
    ...over,
  }) as unknown as PlanDetail;

function fakeRetail(search: ProductMatch[], replacements: ProductMatch[] = []) {
  return {
    findProducts: vi.fn(async (q: string[]) => q.map((query) => ({ query, products: search }))),
    getReplacements: vi.fn(async (items: { productId: string }[]) =>
      items.map((i) => ({ productId: i.productId, replacements })),
    ),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  skuBlocked = false;
  getPlanDetail.mockResolvedValue(plan());
  updateListLineSku.mockResolvedValue(1);
});

describe("lineAlternatives", () => {
  it("merges search + replacements, dedupes by productId, drops non-food, ranks, marks current", async () => {
    const retail = fakeRetail(
      [
        sku({ productId: "current", name: "Яловичина тушкована", price: 129, packSize: "525г" }),
        sku({ productId: "fresh", name: "Яловичина лопатка", price: 210 }),
        sku({ productId: "bow", name: "Бант для оздоблення подарунку" }), // non-food → filtered
      ],
      [sku({ productId: "fresh", name: "Яловичина лопатка", price: 210 })], // dup of search
    );
    const r = await lineAlternatives("p1", "hh", "beef", retail);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const ids = r.alternatives.map((a) => a.productId);
    expect(ids).not.toContain("bow");
    expect(new Set(ids).size).toBe(ids.length); // deduped
    expect(r.alternatives.find((a) => a.productId === "current")!.isCurrent).toBe(true);
    expect(r.alternatives[0]!.isCurrent).toBe(true); // current SKU floated to the top
    expect(ids).toContain("fresh");
    // line total is priced for the needed 500 g: 1 kg pack → 1 pack
    expect(r.alternatives.find((a) => a.productId === "fresh")!.lineTotalUah).toBe(210);
  });

  it("prices a weighted alternative as kg × ₴/kg and carries quantityKg (R0b)", async () => {
    const retail = fakeRetail([
      // fresh beef sold by weight: 210 ₴/kg, step 0.5 kg, need 500 g → 0.5 kg
      sku({
        productId: "fresh",
        name: "Яловичина лопатка",
        price: 210,
        packSize: "100г",
        weighted: true,
        step: 0.5,
      }),
    ]);
    const r = await lineAlternatives("p1", "hh", "beef", retail);
    if (r.status !== "ok") throw new Error(r.status);
    const alt = r.alternatives.find((a) => a.productId === "fresh")!;
    expect(alt).toMatchObject({ quantityKg: 0.5, lineTotalUah: 105 }); // 210 × 0.5, not 210 × 1
  });

  it("drops a safety-blocked candidate", async () => {
    skuBlocked = true;
    const retail = fakeRetail([
      sku({ productId: "ok", name: "Яловичина лопатка" }),
      sku({ productId: "blocked", name: "Яловичина мелена" }),
    ]);
    const r = await lineAlternatives("p1", "hh", "beef", retail);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.alternatives.map((a) => a.productId)).not.toContain("blocked");
  });

  it("not_found for an unknown line", async () => {
    getPlanDetail.mockResolvedValue(plan({ list: [] }) as PlanDetail);
    expect((await lineAlternatives("p1", "hh", "beef", fakeRetail([]))).status).toBe("not_found");
  });
});

describe("setLineSku", () => {
  it("writes a userOverridden, non-confirmation patch for the picked SKU", async () => {
    const retail = fakeRetail([
      sku({ productId: "current", name: "Яловичина тушкована" }),
      sku({ productId: "fresh", name: "Яловичина лопатка", price: 210, packSize: "1кг" }),
    ]);
    const r = await setLineSku("p1", "hh", "beef", "fresh", retail);
    expect(r.status).toBe("ok");
    const patch = updateListLineSku.mock.calls[0]![3];
    expect(patch).toMatchObject({
      productRef: "fresh",
      productName: "Яловичина лопатка",
      decision: "accepted",
      needsConfirmation: false,
      userOverridden: true,
      confidence: null,
      quantityKg: null, // packaged SKU
    });
    expect(clearPreview).toHaveBeenCalledWith("p1");
  });

  it("refuses a checked-out plan", async () => {
    getPlanDetail.mockResolvedValue(plan({ status: "checked_out" }) as PlanDetail);
    const r = await setLineSku(
      "p1",
      "hh",
      "beef",
      "fresh",
      fakeRetail([sku({ productId: "fresh", name: "x" })]),
    );
    expect(r.status).toBe("already_materialized");
    expect(updateListLineSku).not.toHaveBeenCalled();
    expect(applyCartDelta).not.toHaveBeenCalled();
  });

  it("re-syncs the Silpo cart for a materialized plan: drop old SKU, add new, then persist", async () => {
    getPlanDetail.mockResolvedValue(
      plan({ status: "materialized", cartId: "cart-1" }) as PlanDetail,
    );
    const retail = fakeRetail([
      sku({ productId: "fresh", name: "Яловичина лопатка", price: 210, packSize: "1кг" }),
    ]);
    const r = await setLineSku("p1", "hh", "beef", "fresh", retail);
    expect(r.status).toBe("ok");
    expect(applyCartDelta).toHaveBeenCalledWith("p1", "hh", retail, {
      removeProductIds: ["current"],
      addItems: [{ productId: "fresh", companyId: "co", branchId: "br", quantity: 1 }],
    });
    expect(updateListLineSku).toHaveBeenCalled();
    expect(clearPreview).toHaveBeenCalledWith("p1");
  });

  it("does not persist when the cart re-sync fails", async () => {
    getPlanDetail.mockResolvedValue(plan({ status: "materialized" }) as PlanDetail);
    applyCartDelta.mockResolvedValueOnce({ status: "auth_required" } as never);
    const r = await setLineSku(
      "p1",
      "hh",
      "beef",
      "fresh",
      fakeRetail([sku({ productId: "fresh", name: "x", packSize: "1кг" })]),
    );
    expect(r.status).toBe("auth_required");
    expect(updateListLineSku).not.toHaveBeenCalled();
  });

  it("fails closed when the chosen SKU is safety-blocked", async () => {
    skuBlocked = true;
    const retail = fakeRetail([sku({ productId: "blocked", name: "Яловичина мелена" })]);
    const r = await setLineSku("p1", "hh", "beef", "blocked", retail);
    expect(r.status).toBe("rejected");
    expect(updateListLineSku).not.toHaveBeenCalled();
  });
});

describe("reduceLine", () => {
  const materialized = (over: Partial<PlanDetail> = {}) =>
    ({
      ...plan(),
      status: "materialized",
      list: [
        {
          slug: "beef",
          nameUk: "Яловичина",
          neededAmount: 500,
          unit: "g",
          productRef: "beef-sku",
          companyId: "co",
          branchId: "br",
          productName: "Яловичина вирізка",
          packCount: 3,
          quantityKg: null,
        },
      ],
      ...over,
    }) as unknown as PlanDetail;

  it("cuts a packaged line to the available stock, writes the cart, then the row", async () => {
    getPlanDetail.mockResolvedValue(materialized());
    const r = await reduceLine("p1", "hh", "beef", 1, fakeRetail([]));
    expect(r.status).toBe("ok");
    expect(applyCartDelta).toHaveBeenCalledWith("p1", "hh", expect.anything(), {
      removeProductIds: [],
      addItems: [{ productId: "beef-sku", companyId: "co", branchId: "br", quantity: 1 }],
    });
    expect(updateListLineQuantity).toHaveBeenCalledWith("p1", "hh", "beef", {
      packCount: 1,
      quantityKg: null,
    });
  });

  it("returns not_materialized for a draft / checked-out plan without touching the cart", async () => {
    getPlanDetail.mockResolvedValue(plan({ status: "draft" }) as PlanDetail);
    expect((await reduceLine("p1", "hh", "beef", 1, fakeRetail([]))).status).toBe(
      "not_materialized",
    );

    getPlanDetail.mockResolvedValue(plan({ status: "checked_out" }) as PlanDetail);
    expect((await reduceLine("p1", "hh", "beef", 1, fakeRetail([]))).status).toBe(
      "not_materialized",
    );
    expect(applyCartDelta).not.toHaveBeenCalled();
  });

  it("no-ops (still re-reads) when stock already covers the line", async () => {
    getPlanDetail.mockResolvedValue(materialized());
    const r = await reduceLine("p1", "hh", "beef", 9, fakeRetail([]));
    expect(r.status).toBe("ok");
    expect(applyCartDelta).toHaveBeenCalledWith("p1", "hh", expect.anything(), {
      removeProductIds: [],
      addItems: [],
    });
    expect(updateListLineQuantity).not.toHaveBeenCalled();
  });

  it("does not persist the row when the cart write fails", async () => {
    getPlanDetail.mockResolvedValue(materialized());
    applyCartDelta.mockResolvedValueOnce({ status: "error", message: "boom" } as never);
    const r = await reduceLine("p1", "hh", "beef", 1, fakeRetail([]));
    expect(r.status).toBe("error");
    expect(updateListLineQuantity).not.toHaveBeenCalled();
  });
});
