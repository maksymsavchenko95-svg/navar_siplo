import type { ProductMatch } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { rankCandidates } from "./score.js";
import type { MapperDictEntry } from "./types.js";

const MILK: MapperDictEntry = {
  slug: "milk",
  nameUk: "Молоко",
  category: "dairy_eggs",
  baseUnit: "ml",
  densityGMl: 1.03,
  gramsPerPiece: null,
  synonyms: ["молоко", "молоко пастеризоване"],
  allergens: ["milk"],
};

const sku = (
  over: Partial<ProductMatch> & Pick<ProductMatch, "productId" | "name">,
): ProductMatch => ({
  externalProductId: null,
  companyId: "co",
  branchId: "br",
  slug: over.productId,
  price: 40,
  oldPrice: null,
  packSize: "900мл",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  ...over,
});

describe("rankCandidates", () => {
  it("ranks the exact foodstuff above a flavoured / derived variant", () => {
    const ranked = rankCandidates(MILK, 500, [
      sku({ productId: "a", name: "Молоко згущене з цукром", packSize: "370г" }),
      sku({ productId: "b", name: "Молоко пастеризоване 2.5%" }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("b");
  });

  it("penalises a grossly oversized pack", () => {
    const ranked = rankCandidates(MILK, 200, [
      sku({ productId: "big", name: "Молоко", packSize: "5л" }),
      sku({ productId: "ok", name: "Молоко", packSize: "500мл" }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("ok");
    expect(
      ranked.find((r) => r.candidate.productId === "big")!.breakdown.packFit,
    ).toBeLessThanOrEqual(0.1);
  });

  it("uses promo as a tiebreak between otherwise-equal candidates", () => {
    const ranked = rankCandidates(MILK, 900, [
      sku({ productId: "plain", name: "Молоко" }),
      sku({ productId: "promo", name: "Молоко", price: 35, oldPrice: 45 }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("promo");
  });

  it("pushes a price outlier down", () => {
    const ranked = rankCandidates(MILK, 900, [
      sku({ productId: "n1", name: "Молоко", price: 40 }),
      sku({ productId: "n2", name: "Молоко", price: 42 }),
      sku({ productId: "out", name: "Молоко", price: 400 }),
    ]);
    expect(ranked[ranked.length - 1]!.candidate.productId).toBe("out");
  });

  it("treats an unparseable pack as neutral and a weighed candidate as a perfect fit", () => {
    const ranked = rankCandidates(MILK, 500, [
      sku({ productId: "u", name: "Молоко", packSize: "дивна" }),
    ]);
    expect(ranked[0]!.breakdown.packFit).toBe(0.5);

    const w = rankCandidates(
      { ...MILK, baseUnit: "g", slug: "beef", nameUk: "Яловичина", synonyms: ["яловичина"] },
      500,
      [sku({ productId: "w", name: "Яловичина", packSize: "100г", weighted: true, step: 0.5 })],
    );
    expect(w[0]!.breakdown.packFit).toBe(1);
  });

  it("is order-independent (determinism)", () => {
    const cands = [
      sku({ productId: "a", name: "Молоко" }),
      sku({ productId: "b", name: "Молоко пастеризоване" }),
      sku({ productId: "c", name: "Вершки" }),
    ];
    const forward = rankCandidates(MILK, 900, cands);
    const reversed = rankCandidates(MILK, 900, [...cands].reverse());
    expect(forward.map((r) => [r.candidate.productId, r.score])).toEqual(
      reversed.map((r) => [r.candidate.productId, r.score]),
    );
  });
});
