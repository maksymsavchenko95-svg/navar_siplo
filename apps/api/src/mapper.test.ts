import type { ProductDetails, ProductMatch } from "@navar/domain";
import type { SkuMatch } from "@navar/domain";
import type { RetailProvider } from "@navar/retail";
import type { Exclusions } from "@navar/safety";
import { describe, expect, it, vi } from "vitest";

import {
  loadExclusions,
  loadMapperDict,
  makeIngredientSafety,
  makeSkuSafety,
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
  },
  score: 0.8,
  confidence: 0.8,
  decision: "accepted",
  needsConfirmation: false,
  packCount: 1,
  packSize: 400,
  surplusAmount: 100,
  isPromo: false,
  candidatesConsidered: 3,
  rerankSource: null,
  safetyChecked: false,
  blockReason: null,
  ...over,
});

describe("skuMatchesToPrices", () => {
  const ids = new Map([
    ["carrot", "id-carrot"],
    ["milk", "id-milk"],
  ]);

  it("keys by ingredient id, carries promo, and uses the parsed pack size", () => {
    const prices = skuMatchesToPrices([match({ slug: "carrot", isPromo: true })], ids);
    expect(prices.get("id-carrot")).toEqual({ uah: 42, promo: true, packSize: 400 });
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
