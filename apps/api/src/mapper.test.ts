import type { SkuMatch } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { loadMapperDict, skuMatchesToPrices } from "./mapper.js";

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

describe.skipIf(!process.env.DATABASE_URL)("loadMapperDict (integration)", () => {
  it("loads rows and coerces numeric columns", async () => {
    const dict = await loadMapperDict(["milk", "carrot", "chicken_breast"]);
    expect(dict.size).toBeGreaterThanOrEqual(2);
    const milk = dict.get("milk");
    expect(milk).toBeDefined();
    expect(typeof milk!.densityGMl === "number" || milk!.densityGMl === null).toBe(true);
    expect(Array.isArray(milk!.synonyms)).toBe(true);
  });

  it("returns an empty map for no slugs", async () => {
    expect((await loadMapperDict([])).size).toBe(0);
  });
});
