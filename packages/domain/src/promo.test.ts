import { describe, expect, it } from "vitest";

import {
  effectiveUnitPrice,
  hasShelfMarkdown,
  isPromoMatch,
  promoTier,
  tierApplies,
} from "./promo.js";
import type { ProductMatch, SpecialPrice } from "./retail.js";

/**
 * T4.1 — the promo vocabulary. Shapes are the real ones from the M0 audit
 * (`docs/mcp-audit-raw/block2-search.json`): a shelf markdown sets `oldPrice`, a multi-buy
 * campaign sets `specialPrices: [{price, count, type: "from"}]`, and no audited product
 * carried both.
 */
const sku = (over: Partial<ProductMatch> = {}): ProductMatch => ({
  productId: "p1",
  externalProductId: 633700,
  companyId: "c1",
  branchId: "b1",
  slug: "moloko-selianske-2-5-28734",
  name: "Молоко «Селянське» 2,5%",
  price: 144,
  oldPrice: null,
  packSize: "500г",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  specialPrices: [],
  ...over,
});

const from = (price: number, count: number): SpecialPrice => ({ price, count, type: "from" });

describe("hasShelfMarkdown", () => {
  it("is true only when oldPrice is strictly above price", () => {
    expect(hasShelfMarkdown(sku({ price: 100, oldPrice: 130 }))).toBe(true);
    expect(hasShelfMarkdown(sku({ price: 100, oldPrice: 100 }))).toBe(false);
    expect(hasShelfMarkdown(sku({ price: 100, oldPrice: 80 }))).toBe(false);
    expect(hasShelfMarkdown(sku({ price: 100, oldPrice: null }))).toBe(false);
  });
});

describe("promoTier", () => {
  it("reads the real «2+ at 114 ₴» shape", () => {
    expect(promoTier(sku({ price: 144, specialPrices: [from(114, 2)] }))).toEqual({
      minCount: 2,
      price: 114,
    });
  });

  it("is null with no specialPrices at all", () => {
    expect(promoTier(sku())).toBeNull();
    expect(promoTier({ price: 100 })).toBeNull();
  });

  it("ignores a tier that is not actually cheaper than the shelf price", () => {
    expect(promoTier(sku({ price: 100, specialPrices: [from(100, 2)] }))).toBeNull();
    expect(promoTier(sku({ price: 100, specialPrices: [from(120, 2)] }))).toBeNull();
  });

  it('ignores tier types other than "from" rather than guessing at them', () => {
    const odd: SpecialPrice = { price: 50, count: 2, type: "exactly" };
    expect(promoTier(sku({ price: 100, specialPrices: [odd] }))).toBeNull();
  });

  it("picks the cheapest tier, breaking ties on the lower threshold", () => {
    expect(
      promoTier(sku({ price: 200, specialPrices: [from(180, 2), from(150, 5), from(170, 3)] })),
    ).toEqual({ minCount: 5, price: 150 });
    expect(promoTier(sku({ price: 200, specialPrices: [from(150, 5), from(150, 2)] }))).toEqual({
      minCount: 2,
      price: 150,
    });
  });
});

describe("isPromoMatch", () => {
  it("covers markdown-only, tier-only, both, and neither", () => {
    expect(isPromoMatch(sku({ price: 100, oldPrice: 130 }))).toBe(true);
    expect(isPromoMatch(sku({ price: 144, specialPrices: [from(114, 2)] }))).toBe(true);
    expect(isPromoMatch(sku({ price: 144, oldPrice: 160, specialPrices: [from(114, 2)] }))).toBe(
      true,
    );
    expect(isPromoMatch(sku())).toBe(false);
  });

  it("catches the multi-buy promo the old oldPrice-only predicate missed", () => {
    // The regression this change exists for: 5 of 21 promo signals in the M0 audit were
    // specialPrices-only, and `oldPrice > price` scored every one of them as non-promo.
    const multiBuyOnly = sku({ price: 144, oldPrice: null, specialPrices: [from(114, 2)] });
    expect(multiBuyOnly.oldPrice).toBeNull(); // the old predicate's whole input
    expect(isPromoMatch(multiBuyOnly)).toBe(true);
  });
});

describe("tierApplies / effectiveUnitPrice", () => {
  const tier = { minCount: 2, price: 114 };

  it("does not apply below the threshold", () => {
    expect(tierApplies(tier, 1)).toBe(false);
    expect(effectiveUnitPrice(144, tier, 1)).toBe(144);
  });

  it("applies exactly at the threshold", () => {
    expect(tierApplies(tier, 2)).toBe(true);
    expect(effectiveUnitPrice(144, tier, 2)).toBe(114);
  });

  it("applies above the threshold", () => {
    expect(tierApplies(tier, 5)).toBe(true);
    expect(effectiveUnitPrice(144, tier, 5)).toBe(114);
  });

  it("falls back to the shelf price with no tier, including zero packs", () => {
    expect(tierApplies(null, 10)).toBe(false);
    expect(effectiveUnitPrice(144, null, 10)).toBe(144);
    expect(effectiveUnitPrice(144, undefined, 3)).toBe(144);
    expect(effectiveUnitPrice(144, tier, 0)).toBe(144);
  });
});
