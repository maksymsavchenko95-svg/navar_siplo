import type { ProductMatch, ProductSearchResult, ReplacementResult } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { mapPlan } from "./map.js";
import type {
  IngredientSafetyCheck,
  MapperDictEntry,
  MapperRetail,
  PlanIngredientLine,
  RerankFn,
  SkuSafetyCheck,
} from "./types.js";

const dictEntry = (
  over: Partial<MapperDictEntry> & Pick<MapperDictEntry, "slug" | "nameUk">,
): MapperDictEntry => ({
  category: "other",
  baseUnit: "g",
  densityGMl: null,
  gramsPerPiece: null,
  synonyms: [],
  allergens: [],
  ...over,
});

const DICT = new Map(
  [
    dictEntry({ slug: "carrot", nameUk: "Морква", category: "vegetable" }),
    dictEntry({
      slug: "milk",
      nameUk: "Молоко",
      category: "dairy_eggs",
      baseUnit: "ml",
      densityGMl: 1.03,
    }),
    dictEntry({ slug: "dill", nameUk: "Кріп", category: "vegetable" }),
    dictEntry({
      slug: "wheat_flour",
      nameUk: "Борошно пшеничне",
      category: "grain",
      allergens: ["gluten"],
    }),
    dictEntry({ slug: "soy_sauce", nameUk: "Соус соєвий", category: "pantry", baseUnit: "ml" }),
    dictEntry({
      slug: "cumin_ground",
      nameUk: "Зіра",
      category: "spice_herb",
      synonyms: ["зіра", "кмин"],
    }),
  ].map((e) => [e.slug, e]),
);

const sku = (
  over: Partial<ProductMatch> & Pick<ProductMatch, "productId" | "name">,
): ProductMatch => ({
  externalProductId: null,
  companyId: "co",
  branchId: "br-1",
  slug: over.productId,
  price: 40,
  oldPrice: null,
  packSize: "500г",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  specialPrices: [],
  ...over,
});

/** A fake retail whose search answers from a fixed `query → products` table. */
function fakeRetail(
  table: Record<string, ProductMatch[]>,
  replacements: Record<string, ProductMatch[]> = {},
): MapperRetail & { findSpy: ReturnType<typeof vi.fn>; repSpy: ReturnType<typeof vi.fn> } {
  const findSpy = vi.fn(async (queries: string[]): Promise<ProductSearchResult[]> =>
    queries.map((query) => ({ query, products: table[query] ?? [] })),
  );
  const repSpy = vi.fn(
    async (items: { productId: string; companyId: string }[]): Promise<ReplacementResult[]> =>
      items.map((i) => ({ productId: i.productId, replacements: replacements[i.productId] ?? [] })),
  );
  return { findProducts: findSpy, getReplacements: repSpy, findSpy, repSpy };
}

const fallbackRerank: RerankFn = async (input) => ({
  index: 0,
  confidence: 0.45 + ((input.candidates[0]?.score ?? 0) - (input.candidates[1]?.score ?? 0)),
  source: "fallback",
});

const lines = (xs: PlanIngredientLine[]) => xs;

describe("mapPlan", () => {
  it("clear winner: accepts top-1 and does not call the re-ranker", async () => {
    const retail = fakeRetail({
      морква: [
        sku({ productId: "carrot-ok", name: "Морква" }),
        sku({ productId: "carrot-cake", name: "Морквяний торт заморожений", inStock: true }),
      ],
    });
    const rerank = vi.fn(fallbackRerank);
    const res = await mapPlan(
      { lines: lines([{ slug: "carrot", amount: 300, unit: "g" }]), dict: DICT },
      { retail, rerank },
    );
    expect(rerank).not.toHaveBeenCalled();
    expect(res.matches[0]).toMatchObject({
      decision: "accepted",
      match: { productId: "carrot-ok" },
    });
    expect(res.branchId).toBe("br-1");
  });

  it("close call: calls the re-ranker once with ≤5 candidates and takes its pick", async () => {
    const retail = fakeRetail({
      молоко: [
        sku({ productId: "m1", name: "Молоко Яготинське відбіркове" }),
        sku({ productId: "m2", name: "Молоко Селянське відбіркове" }),
      ],
    });
    // pick whichever candidate the LLM was shown as "Селянське"
    const rerank = vi.fn<RerankFn>(async (input) => ({
      index: input.candidates.findIndex((c) => c.name.includes("Селянське")),
      confidence: 0.82,
      source: "llm",
    }));
    const res = await mapPlan(
      { lines: lines([{ slug: "milk", amount: 500, unit: "ml" }]), dict: DICT },
      { retail, rerank },
    );
    expect(rerank).toHaveBeenCalledTimes(1);
    expect(rerank.mock.calls[0]![0].candidates.length).toBeLessThanOrEqual(5);
    expect(res.matches[0]).toMatchObject({
      decision: "reranked",
      confidence: 0.82,
      rerankSource: "llm",
      match: { productId: "m2" },
    });
  });

  it("low confidence → needs_confirmation, match still populated and counted", async () => {
    const retail = fakeRetail({
      молоко: [
        sku({ productId: "m1", name: "Молоко Яготинське відбіркове" }),
        sku({ productId: "m2", name: "Молоко Селянське відбіркове" }),
      ],
    });
    const rerank = vi.fn<RerankFn>(async () => ({ index: 0, confidence: 0.3, source: "llm" }));
    const res = await mapPlan(
      { lines: lines([{ slug: "milk", amount: 500, unit: "ml" }]), dict: DICT },
      { retail, rerank },
    );
    expect(res.matches[0]).toMatchObject({
      decision: "needs_confirmation",
      needsConfirmation: true,
    });
    expect(res.matches[0]!.match).not.toBeNull();
    expect(res.stats.needsConfirmation).toBe(1);
  });

  it("no search results → sku_unknown, still counted in stats.noMatch", async () => {
    const res = await mapPlan(
      { lines: lines([{ slug: "dill", amount: 10, unit: "g" }]), dict: DICT },
      { retail: fakeRetail({}), rerank: vi.fn(fallbackRerank) },
    );
    expect(res.matches[0]).toMatchObject({ decision: "sku_unknown", match: null });
    expect(res.stats).toMatchObject({ total: 1, matched: 0, noMatch: 1 });
  });

  it("R7: search returns only a non-food SKU → filtered out → sku_unknown", async () => {
    const retail = fakeRetail({
      зіра: [sku({ productId: "bow", name: "Бант для оздоблення подарунку Happy.com Зірка 8 см" })],
    });
    const res = await mapPlan(
      { lines: lines([{ slug: "cumin_ground", amount: 3, unit: "g" }]), dict: DICT },
      { retail, rerank: vi.fn(fallbackRerank) },
    );
    expect(res.matches[0]).toMatchObject({ decision: "sku_unknown", match: null });
  });

  it("out-of-stock pick → replacement funnel chooses a new SKU", async () => {
    const retail = fakeRetail(
      { морква: [sku({ productId: "carrot-oos", name: "Морква", inStock: false })] },
      { "carrot-oos": [sku({ productId: "carrot-alt", name: "Морква мита", inStock: true })] },
    );
    const res = await mapPlan(
      { lines: lines([{ slug: "carrot", amount: 300, unit: "g" }]), dict: DICT },
      { retail, rerank: vi.fn(fallbackRerank) },
    );
    expect(retail.repSpy).toHaveBeenCalledWith([{ productId: "carrot-oos", companyId: "co" }]);
    expect(res.matches[0]).toMatchObject({
      decision: "replacement",
      match: { productId: "carrot-alt" },
      replacedFromName: "Морква", // T4.4 B4 — the out-of-stock SKU it stands in for
    });
  });

  it("out-of-stock pick, no replacement found → needs_confirmation, outOfStock flagged (F5)", async () => {
    const retail = fakeRetail(
      { морква: [sku({ productId: "carrot-oos", name: "Морква", inStock: false })] },
      { "carrot-oos": [] }, // funnel returns nothing
    );
    const res = await mapPlan(
      { lines: lines([{ slug: "carrot", amount: 300, unit: "g" }]), dict: DICT },
      { retail, rerank: vi.fn(fallbackRerank) },
    );
    expect(res.matches[0]).toMatchObject({
      decision: "needs_confirmation",
      needsConfirmation: true,
      outOfStock: true,
    });
    expect(res.matches[0]!.match).not.toBeNull(); // still recorded
  });

  it("out-of-stock pick with no companyId → funnel skipped, still flagged (F5)", async () => {
    const retail = fakeRetail({
      морква: [sku({ productId: "carrot-oos", name: "Морква", inStock: false, companyId: "" })],
    });
    const res = await mapPlan(
      { lines: lines([{ slug: "carrot", amount: 300, unit: "g" }]), dict: DICT },
      { retail, rerank: vi.fn(fallbackRerank) },
    );
    expect(retail.repSpy).not.toHaveBeenCalled();
    expect(res.matches[0]).toMatchObject({ decision: "needs_confirmation", outOfStock: true });
  });

  it("is deterministic with the offline fallback re-ranker", async () => {
    const table = {
      молоко: [
        sku({ productId: "m1", name: "Молоко Яготинське відбіркове" }),
        sku({ productId: "m2", name: "Молоко Селянське відбіркове" }),
      ],
      морква: [sku({ productId: "c1", name: "Морква" })],
    };
    const run = () =>
      mapPlan(
        {
          lines: lines([
            { slug: "milk", amount: 500, unit: "ml" },
            { slug: "carrot", amount: 300, unit: "g" },
          ]),
          dict: DICT,
        },
        { retail: fakeRetail(table), rerank: fallbackRerank },
      );
    expect(await run()).toEqual(await run());
  });

  it("T4.5: parallel re-ranks stay deterministic and apply in ingredient order", async () => {
    // Every ingredient below is a close call → all go through the re-ranker concurrently.
    const table = {
      молоко: [
        sku({ productId: "m1", name: "Молоко А" }),
        sku({ productId: "m2", name: "Молоко Б" }),
      ],
      "соус соєвий": [
        sku({ productId: "s1", name: "Соус А", packSize: "150мл" }),
        sku({ productId: "s2", name: "Соус Б", packSize: "150мл" }),
      ],
      зіра: [
        sku({ productId: "z1", name: "Зіра А", packSize: "20г" }),
        sku({ productId: "z2", name: "Зіра Б", packSize: "20г" }),
      ],
    };
    // Resolves with jittered timing so completion order differs from input order.
    const jitterRerank: RerankFn = (input) =>
      new Promise((res) =>
        setTimeout(
          () => res({ index: input.candidates.length - 1, confidence: 0.7, source: "llm" }),
          Math.floor(Math.random() * 8),
        ),
      );

    const planLines = lines([
      { slug: "milk", amount: 500, unit: "ml" },
      { slug: "soy_sauce", amount: 30, unit: "ml" },
      { slug: "cumin_ground", amount: 3, unit: "g" },
    ]);
    const run = () =>
      mapPlan(
        { lines: planLines, dict: DICT },
        { retail: fakeRetail(table), rerank: jitterRerank },
      );

    const a = await run();
    const b = await run();
    // same output every run despite the parallel re-ranks finishing out of order
    expect(a).toEqual(b);
    // `consolidate` fixes a stable order; each line took the re-ranker's pick (last candidate)
    const bySlug = new Map(a.matches.map((m) => [m.slug, m]));
    expect(bySlug.get("milk")!.match?.productId).toBe("m2");
    expect(bySlug.get("soy_sauce")!.match?.productId).toBe("s2");
    expect(bySlug.get("cumin_ground")!.match?.productId).toBe("z2");
    expect(a.matches.every((m) => m.rerankSource === "llm")).toBe(true);
    // order is a pure function of the input, not of re-rank timing
    expect(a.matches.map((m) => m.slug)).toEqual(b.matches.map((m) => m.slug));
  });

  it("consolidates identical ingredients into one SkuMatch with pack/surplus", async () => {
    const retail = fakeRetail({
      морква: [sku({ productId: "c1", name: "Морква", packSize: "400г" })],
    });
    const res = await mapPlan(
      {
        lines: lines([
          { slug: "carrot", amount: 500, unit: "g" },
          { slug: "carrot", amount: 400, unit: "g" },
        ]),
        dict: DICT,
      },
      { retail, rerank: vi.fn(fallbackRerank) },
    );
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]).toMatchObject({ neededAmount: 900, packCount: 3, surplusAmount: 300 });
  });

  // ─── Safety gate (T2.2) ────────────────────────────────────────────────────

  /** Blocks any ingredient carrying one of `allergens`, or any slug in `slugs`. */
  const ingredientSafetyFor =
    (allergens: string[], slugs: string[] = []): IngredientSafetyCheck =>
    (entry) => {
      if (slugs.includes(entry.slug))
        return { blocked: true, reason: `«${entry.nameUk}» виключено` };
      const hit = entry.allergens.filter((a) => allergens.includes(a));
      return hit.length
        ? { blocked: true, reason: `«${entry.nameUk}» містить алерген (глютен)` }
        : { blocked: false, reason: null };
    };

  it("ingredient-level block: excluded allergen → blocked_unsafe, no search", async () => {
    const retail = fakeRetail({
      борошно: [sku({ productId: "f1", name: "Борошно" })],
      морква: [sku({ productId: "c1", name: "Морква" })],
    });
    const res = await mapPlan(
      {
        lines: lines([
          { slug: "wheat_flour", amount: 200, unit: "g" },
          { slug: "carrot", amount: 100, unit: "g" },
        ]),
        dict: DICT,
      },
      { retail, rerank: vi.fn(fallbackRerank), ingredientSafety: ingredientSafetyFor(["gluten"]) },
    );
    const flour = res.matches.find((m) => m.slug === "wheat_flour")!;
    expect(flour).toMatchObject({ decision: "blocked_unsafe", match: null, safetyChecked: true });
    expect(flour.blockReason).toMatch(/глютен/);
    expect(res.stats.blocked).toBe(1);
    expect(retail.findSpy.mock.calls.flat(2)).not.toContain("борошно");
    expect(res.matches.find((m) => m.slug === "carrot")!.match).not.toBeNull();
  });

  it("ingredient-level block: strict-dislike slug → blocked_unsafe", async () => {
    const res = await mapPlan(
      { lines: lines([{ slug: "carrot", amount: 100, unit: "g" }]), dict: DICT },
      {
        retail: fakeRetail({}),
        rerank: vi.fn(fallbackRerank),
        ingredientSafety: ingredientSafetyFor([], ["carrot"]),
      },
    );
    expect(res.matches[0]).toMatchObject({ decision: "blocked_unsafe", match: null });
  });

  it("SKU-level block: skuSafety vetoes a chosen SKU", async () => {
    const retail = fakeRetail({
      "соус соєвий": [sku({ productId: "s1", name: "Соус соєвий Kikkoman" })],
      морква: [sku({ productId: "c1", name: "Морква" })],
    });
    const skuSafety: SkuSafetyCheck = vi.fn(async ({ slug }) =>
      slug === "soy_sauce"
        ? { blocked: true, reason: "Не додано: у складі вказано алерген (глютен)." }
        : { blocked: false, reason: null },
    );
    const res = await mapPlan(
      {
        lines: lines([
          { slug: "soy_sauce", amount: 30, unit: "ml" },
          { slug: "carrot", amount: 100, unit: "g" },
        ]),
        dict: DICT,
      },
      {
        retail,
        rerank: vi.fn(fallbackRerank),
        ingredientSafety: ingredientSafetyFor(["gluten"]),
        skuSafety,
      },
    );
    expect(skuSafety).toHaveBeenCalled();
    const soy = res.matches.find((m) => m.slug === "soy_sauce")!;
    expect(soy).toMatchObject({ decision: "blocked_unsafe", match: null, safetyChecked: true });
    expect(res.matches.find((m) => m.slug === "carrot")!.match).not.toBeNull();
    expect(res.stats.blocked).toBe(1);
  });

  it("SKU-level check also covers a replacement SKU (FR-SAFE-004)", async () => {
    const retail = fakeRetail(
      { морква: [sku({ productId: "c-oos", name: "Морква", inStock: false })] },
      { "c-oos": [sku({ productId: "c-alt", name: "Морква мита", inStock: true })] },
    );
    const seen: string[] = [];
    const skuSafety: SkuSafetyCheck = vi.fn(async ({ chosen }) => {
      seen.push(chosen.productId);
      return { blocked: false, reason: null };
    });
    const res = await mapPlan(
      { lines: lines([{ slug: "carrot", amount: 300, unit: "g" }]), dict: DICT },
      {
        retail,
        rerank: vi.fn(fallbackRerank),
        ingredientSafety: ingredientSafetyFor(["milk"]),
        skuSafety,
      },
    );
    expect(seen).toEqual(["c-alt"]); // the replacement, not the OOS original
    expect(res.matches[0]).toMatchObject({ decision: "replacement", safetyChecked: true });
  });

  it("no safety deps → safetyChecked stays false", async () => {
    const res = await mapPlan(
      { lines: lines([{ slug: "carrot", amount: 100, unit: "g" }]), dict: DICT },
      {
        retail: fakeRetail({ морква: [sku({ productId: "c1", name: "Морква" })] }),
        rerank: vi.fn(fallbackRerank),
      },
    );
    expect(res.matches[0]!.safetyChecked).toBe(false);
    expect(res.stats.blocked).toBe(0);
  });
});
