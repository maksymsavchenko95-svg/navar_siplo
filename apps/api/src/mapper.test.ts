import type { ProductDetails, ProductMatch } from "@navar/domain";
import type { SkuMatch } from "@navar/domain";
import type { RecipeCandidate } from "@navar/planner";
import type { RetailProvider } from "@navar/retail";
import type { Exclusions } from "@navar/safety";
import { describe, expect, it, vi } from "vitest";

import {
  loadExclusions,
  loadMapperDict,
  makeIngredientSafety,
  makeSkuSafety,
  resizePlanList,
  skuMatchesToPrices,
} from "./mapper.js";

const match = (over: Partial<SkuMatch> & Pick<SkuMatch, "slug">): SkuMatch => ({
  ingredientNameUk: over.slug,
  query: over.slug,
  neededAmount: 300,
  neededUnit: "g",
  match: {
    productId: `${over.slug}-sku`,
    externalProductId: null,
    companyId: "co",
    branchId: "br",
    slug: `${over.slug}-sku`,
    name: over.slug,
    price: 42,
    oldPrice: null,
    packSize: "400г",
    imageUrl: null,
    inStock: true,
    weighted: false,
    step: null,
    specialPrices: [],
  },
  score: 0.8,
  confidence: 0.8,
  decision: "accepted",
  needsConfirmation: false,
  packCount: 1,
  packSize: 400,
  quantityKg: null,
  surplusAmount: 100,
  isPromo: false,
  promoTier: null,
  candidatesConsidered: 3,
  rerankSource: null,
  safetyChecked: false,
  blockReason: null,
  outOfStock: false,
  replacedFromName: null,
  ...over,
});

describe("skuMatchesToPrices", () => {
  const ids = new Map([
    ["carrot", "id-carrot"],
    ["milk", "id-milk"],
  ]);

  it("keys by ingredient id and uses the parsed pack size", () => {
    const prices = skuMatchesToPrices([match({ slug: "carrot" })], ids);
    expect(prices.get("id-carrot")).toEqual({
      uah: 42,
      promo: false,
      packSize: 400,
      tier: null,
    });
  });

  it("derives `promo` from the SKU's shelf markdown, not the mapper's isPromo flag (T4.1)", () => {
    // `SkuMatch.isPromo` means "some discount exists" (markdown *or* multi-buy). The solver
    // needs the narrower question — is there an unconditional markdown? — because a
    // multi-buy tier only pays out once enough packs are bought.
    const markdown = match({ slug: "carrot", isPromo: true });
    markdown.match!.oldPrice = 60;
    expect(skuMatchesToPrices([markdown], ids).get("id-carrot")).toMatchObject({ promo: true });

    // A tier-only SKU is *not* an unconditional markdown; the tier travels separately.
    const tierOnly = match({ slug: "milk", isPromo: true, promoTier: { minCount: 2, price: 30 } });
    expect(skuMatchesToPrices([tierOnly], ids).get("id-milk")).toMatchObject({
      promo: false,
      tier: { minCount: 2, price: 30 },
    });
  });

  it("substitutes the needed amount when the pack size is unknown", () => {
    const prices = skuMatchesToPrices(
      [match({ slug: "milk", packSize: null, neededAmount: 500 })],
      ids,
    );
    expect(prices.get("id-milk")).toMatchObject({ packSize: 500 });
  });

  it("skips unmatched lines and ids not in the map", () => {
    const prices = skuMatchesToPrices(
      [match({ slug: "carrot", match: null }), match({ slug: "unknown" })],
      ids,
    );
    expect(prices.size).toBe(0);
  });

  it("prices weighted goods per weighing step so recipeCost lands on kg × ₴/kg (R0b)", () => {
    // Silpo weighted: price is ₴/kg (250.38), step is kg (0.5), packSize is stepGrams (500).
    const weighed = match({ slug: "carrot" });
    weighed.match!.weighted = true;
    weighed.match!.step = 0.5;
    weighed.match!.price = 250.38;
    weighed.packSize = 500;
    weighed.promoTier = { minCount: 2, price: 200 };
    // recipeCost: packs = ceil(needed / packSize); lineCost = packs × uah.
    // uah = 250.38 × 0.5 = 125.19 → a 600 g need buys 2 steps → 250.38 ₴ = 1 kg × ₴/kg. ✓
    expect(skuMatchesToPrices([weighed], ids).get("id-carrot")).toEqual({
      uah: 125.19,
      promo: false,
      packSize: 500,
      tier: null, // per-kg tier can't compose with per-step pricing
    });
  });
});

describe("resizePlanList (R0)", () => {
  const idBySlug = new Map([
    ["carrot", "id-carrot"],
    ["onion", "id-onion"],
    ["beef", "id-beef"],
  ]);

  const cand = (slug: string, servings: number, lines: [string, number][]): RecipeCandidate => ({
    recipeId: `r-${slug}`,
    slug,
    titleUk: slug,
    servings,
    activeMinutes: 20,
    ingredients: lines.map(([s, amount]) => ({
      id: idBySlug.get(s)!,
      amount,
      unit: "g",
      category: "vegetable",
      optional: false,
    })),
    macrosPerServing: { kcal: 500, protein: 25, fat: 15, carbs: 55, fiber: 0 },
  });

  // corpus mapper: carrot summed across the whole corpus (2 kg), onion 1 kg, plus a
  // parsley line no chosen recipe uses.
  const corpus = {
    branchId: "br",
    consolidated: [],
    stats: { total: 3, matched: 3, needsConfirmation: 0, noMatch: 0, blocked: 0 },
    matches: [
      match({ slug: "carrot", neededAmount: 2000, packCount: 5 }),
      match({ slug: "onion", neededAmount: 1000, packCount: 3 }),
      match({ slug: "parsley", neededAmount: 200, packCount: 1 }),
    ],
  };

  it("re-consolidates only the picked recipes, scaled by servings / recipe.servings", () => {
    // household of 4; recipe A yields 4 (scale 1) uses 300 g carrot; recipe B yields 2
    // (scale 2) uses 100 g carrot + 250 g onion.
    const candidates = [
      cand("stew", 4, [["carrot", 300]]),
      cand("soup", 2, [
        ["carrot", 100],
        ["onion", 250],
      ]),
    ];
    const out = resizePlanList(
      corpus,
      [
        { slug: "stew", portionScale: 1 },
        { slug: "soup", portionScale: 1 },
      ],
      candidates,
      4,
      idBySlug,
    );
    const bySlug = new Map(out.matches.map((m) => [m.slug, m]));
    // carrot: 300×1 + 100×(4/2)×1 = 500 g
    expect(bySlug.get("carrot")).toMatchObject({ neededAmount: 500, packCount: 2 });
    // onion: 250×(4/2) = 500 g
    expect(bySlug.get("onion")).toMatchObject({ neededAmount: 500, packCount: 2 });
    // parsley is used by no picked recipe → dropped
    expect(bySlug.has("parsley")).toBe(false);
    expect(out.stats).toEqual({
      total: 2,
      matched: 2,
      needsConfirmation: 0,
      noMatch: 0,
      blocked: 0,
    });
  });

  it("multiplies the need by the day's portionScale", () => {
    const out = resizePlanList(
      corpus,
      [{ slug: "stew", portionScale: 1.4 }],
      [cand("stew", 4, [["carrot", 300]])],
      4,
      idBySlug,
    );
    // 300 × (4/4) × 1.4 = 420 g → 2 packs of 400
    expect(out.matches[0]).toMatchObject({ slug: "carrot", neededAmount: 420, packCount: 2 });
  });

  it("Σ neededAmount for a 1-serving plan is far below the corpus sum", () => {
    const out = resizePlanList(
      corpus,
      [{ slug: "stew", portionScale: 1 }],
      [cand("stew", 4, [["carrot", 300]])],
      1,
      idBySlug,
    );
    // 300 × (1/4) = 75 g, vs the corpus 2000 g
    expect(out.matches[0]!.neededAmount).toBe(75);
  });
});

const GLUTEN: Exclusions = { allergens: ["gluten"], ingredients: [], strictMode: false };

const dictEntry = (slug: string, category: string, allergens: string[] = []) =>
  ({
    slug,
    nameUk: slug,
    category,
    baseUnit: "g",
    densityGMl: null,
    gramsPerPiece: null,
    synonyms: [],
    allergens,
  }) as Parameters<ReturnType<typeof makeIngredientSafety>>[0];

const sku = (over: Partial<ProductMatch>): ProductMatch => ({
  productId: "p1",
  externalProductId: null,
  companyId: "co",
  branchId: "br",
  slug: "s1",
  name: "S1",
  price: 10,
  oldPrice: null,
  packSize: null,
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  specialPrices: [],
  ...over,
});

const details = (over: Partial<ProductDetails>): ProductDetails => ({
  slug: "s1",
  name: "S1",
  price: 10,
  oldPrice: null,
  inStock: true,
  weighted: false,
  packSize: null,
  step: null,
  attributes: {},
  composition: null,
  allergens: [],
  kcal100: null,
  protein100: null,
  fat100: null,
  carbs100: null,
  ...over,
});

describe("makeIngredientSafety", () => {
  it("blocks an ingredient whose allergen union hits the exclusion", () => {
    const check = makeIngredientSafety(GLUTEN);
    expect(check(dictEntry("wheat_flour", "grain", ["gluten"]))).toMatchObject({ blocked: true });
    expect(check(dictEntry("carrot", "vegetable"))).toEqual({ blocked: false, reason: null });
  });
});

describe("makeSkuSafety", () => {
  const retailWith = (fn: () => Promise<ProductDetails>): RetailProvider =>
    ({ getProductDetails: vi.fn(fn) }) as unknown as RetailProvider;

  it("skips the fetch for a non-risk category", async () => {
    const spy = vi.fn();
    const check = makeSkuSafety(
      { getProductDetails: spy } as unknown as RetailProvider,
      GLUTEN,
      "hh",
    );
    expect(
      await check({
        slug: "carrot",
        category: "vegetable",
        ingredientAllergens: [],
        chosen: sku({}),
      }),
    ).toEqual({
      blocked: false,
      reason: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks a risk-category SKU that declares the allergen", async () => {
    const check = makeSkuSafety(
      retailWith(async () => details({ allergens: ["ГЛЮТЕН"] })),
      GLUTEN,
      "hh",
    );
    const out = await check({
      slug: "soy_sauce",
      category: "pantry",
      ingredientAllergens: [],
      chosen: sku({}),
    });
    expect(out.blocked).toBe(true);
  });

  it("fails closed when the details fetch throws", async () => {
    const check = makeSkuSafety(
      retailWith(async () => {
        throw new Error("boom");
      }),
      GLUTEN,
      "hh",
    );
    const out = await check({
      slug: "soy_sauce",
      category: "pantry",
      ingredientAllergens: [],
      chosen: sku({}),
    });
    expect(out.blocked).toBe(true);
  });

  it("passes a risk-category SKU whose composition clears", async () => {
    const check = makeSkuSafety(
      retailWith(async () => details({ allergens: ["МОЛОКО"], composition: "молоко, сіль" })),
      GLUTEN,
      "hh",
    );
    const out = await check({
      slug: "cheese",
      category: "pantry",
      ingredientAllergens: [],
      chosen: sku({}),
    });
    expect(out).toEqual({ blocked: false, reason: null });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("loadMapperDict / loadExclusions (integration)", () => {
  it("loadMapperDict loads rows, coerces numerics, carries allergens", async () => {
    const dict = await loadMapperDict(["milk", "carrot", "wheat_flour"]);
    expect(dict.size).toBeGreaterThanOrEqual(2);
    const flour = dict.get("wheat_flour");
    expect(flour?.allergens).toContain("gluten");
    expect(Array.isArray(dict.get("milk")!.synonyms)).toBe(true);
  });

  it("returns an empty map for no slugs", async () => {
    expect((await loadMapperDict([])).size).toBe(0);
  });

  it("loadExclusions resolves the seeded demo household's gluten allergy", async () => {
    const { resolveHouseholdId } = await import("./household.js");
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    const x = await loadExclusions(id);
    expect(x.allergens).toContain("gluten");
  });
});
