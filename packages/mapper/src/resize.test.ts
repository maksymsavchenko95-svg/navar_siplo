import type { ProductMatch, SkuMatch } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { resizeMatches, statsFor } from "./resize.js";

const productMatch = (over: Partial<ProductMatch> = {}): ProductMatch => ({
  productId: "sku-1",
  externalProductId: null,
  companyId: "co",
  branchId: "br",
  slug: "sku-1",
  name: "SKU",
  price: 40,
  oldPrice: null,
  packSize: "400г",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  specialPrices: [],
  ...over,
});

const skuMatch = (over: Partial<SkuMatch> & Pick<SkuMatch, "slug">): SkuMatch => ({
  ingredientNameUk: over.slug,
  query: over.slug,
  neededAmount: 2000, // corpus-wide sum
  neededUnit: "g",
  match: productMatch(),
  score: 0.8,
  confidence: 0.8,
  decision: "accepted",
  needsConfirmation: false,
  packCount: 5,
  packSize: 400,
  quantityKg: null,
  surplusAmount: 0,
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

describe("resizeMatches", () => {
  it("recomputes needed / packCount for the picked amount and keeps the SKU + verdict", () => {
    const [m] = resizeMatches(
      [skuMatch({ slug: "carrot", confidence: 0.42 })],
      new Map([["carrot", 300]]),
    );
    expect(m).toMatchObject({
      slug: "carrot",
      neededAmount: 300, // was 2000
      packCount: 1, // 300 / 400 → 1 pack, was 5
      packSize: 400,
      quantityKg: null,
      confidence: 0.42, // untouched
      decision: "accepted",
    });
    expect(m!.match?.productId).toBe("sku-1");
  });

  it("prices weighted goods in kilograms", () => {
    const [m] = resizeMatches(
      [
        skuMatch({
          slug: "garlic",
          match: productMatch({ weighted: true, step: 0.1, packSize: "100г", price: 159 }),
        }),
      ],
      new Map([["garlic", 251]]),
    );
    // 251 g, step 0.1 kg → buy 300 g = 0.3 kg (3 steps)
    expect(m).toMatchObject({ neededAmount: 251, packCount: 3, packSize: 100, quantityKg: 0.3 });
  });

  it("drops a match for an ingredient no picked recipe uses", () => {
    const out = resizeMatches(
      [skuMatch({ slug: "carrot" }), skuMatch({ slug: "bay_leaf" })],
      new Map([["carrot", 300]]),
    );
    expect(out.map((m) => m.slug)).toEqual(["carrot"]);
  });

  it("keeps an unmatched / blocked line (match: null) at packCount 0", () => {
    const [m] = resizeMatches(
      [skuMatch({ slug: "saffron", match: null, decision: "sku_unknown", packCount: 0 })],
      new Map([["saffron", 2]]),
    );
    expect(m).toMatchObject({ slug: "saffron", neededAmount: 2, packCount: 0, quantityKg: null });
  });

  it("is deterministic", () => {
    const need = new Map([["carrot", 640]]);
    const ms = [skuMatch({ slug: "carrot" })];
    expect(resizeMatches(ms, need)).toEqual(resizeMatches(ms, need));
  });
});

describe("statsFor", () => {
  it("counts matched / needsConfirmation / noMatch / blocked", () => {
    expect(
      statsFor([
        skuMatch({ slug: "a" }),
        skuMatch({ slug: "b", needsConfirmation: true }),
        skuMatch({ slug: "c", match: null, decision: "sku_unknown" }),
        skuMatch({ slug: "d", match: null, decision: "blocked_unsafe" }),
      ]),
    ).toEqual({ total: 4, matched: 2, needsConfirmation: 1, noMatch: 1, blocked: 1 });
  });
});
