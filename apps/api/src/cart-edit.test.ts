import type { ListLineSkuPatch } from "@navar/db";
import type { PlanDetail, ProductMatch } from "@navar/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlanDetail = vi.fn<(id: string, hh: string) => Promise<PlanDetail | null>>();
const updateListLineSku =
  vi.fn<(id: string, hh: string, slug: string, patch: ListLineSkuPatch) => Promise<number>>();
vi.mock("@navar/db", () => ({
  getPlanDetail: (...a: [string, string]) => getPlanDetail(...a),
  updateListLineSku: (...a: [string, string, string, ListLineSkuPatch]) => updateListLineSku(...a),
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

const { lineAlternatives, setLineSku } = await import("./cart-edit.js");

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
    });
    expect(clearPreview).toHaveBeenCalledWith("p1");
  });

  it("refuses a materialised plan", async () => {
    getPlanDetail.mockResolvedValue(plan({ status: "materialized" }) as PlanDetail);
    const r = await setLineSku(
      "p1",
      "hh",
      "beef",
      "fresh",
      fakeRetail([sku({ productId: "fresh", name: "x" })]),
    );
    expect(r.status).toBe("already_materialized");
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
