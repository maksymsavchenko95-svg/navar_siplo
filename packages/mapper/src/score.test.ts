import type { ProductMatch } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { isWrongForm, rankCandidates } from "./score.js";
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
  specialPrices: [],
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

  it("scores a multi-buy tier as promo, not just an oldPrice markdown (T4.1)", () => {
    // The «Гуртом дешевше» shape: oldPrice is null, the discount lives in specialPrices.
    const ranked = rankCandidates(MILK, 900, [
      sku({ productId: "plain", name: "Молоко" }),
      sku({
        productId: "multibuy",
        name: "Молоко",
        specialPrices: [{ price: 30, count: 2, type: "from" }],
      }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("multibuy");
    expect(ranked[0]!.breakdown.promo).toBe(1);
  });

  it("keeps scores unclamped so the promo weight is never truncated away", () => {
    // The positive weights sum to 1.0 by design; if that invariant breaks, clamp01 starts
    // compressing differences between strong candidates and promo stops steering.
    const ranked = rankCandidates(MILK, 900, [
      sku({ productId: "plain", name: "Молоко" }),
      sku({ productId: "promo", name: "Молоко", price: 35, oldPrice: 45 }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("promo");
    expect(ranked[0]!.score).toBeLessThan(1);
    expect(ranked[0]!.score - ranked[1]!.score).toBeCloseTo(0.2, 5);
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

const entry = (
  over: Partial<MapperDictEntry> & Pick<MapperDictEntry, "slug" | "nameUk" | "category">,
): MapperDictEntry => ({
  baseUnit: "g",
  densityGMl: null,
  gramsPerPiece: null,
  synonyms: [over.nameUk.toLowerCase()],
  allergens: [],
  ...over,
});

const MIN_CONFIDENCE = 0.6;

describe("rankCandidates — R7 form + ₴/base-unit + category pack fit", () => {
  it("ranks fresh bell pepper above the pickled jar (form penalty)", () => {
    const pepper = entry({ slug: "bell_pepper", nameUk: "Перець солодкий", category: "vegetable" });
    const ranked = rankCandidates(pepper, 200, [
      sku({ productId: "fresh", name: "Перець солодкий", packSize: "1шт", weighted: true }),
      sku({
        productId: "pickled",
        name: "Перець солодкий «Премія»® маринований пастеризований",
        packSize: "480г",
      }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("fresh");
    const pickled = ranked.find((r) => r.candidate.productId === "pickled")!;
    expect(pickled.breakdown.form).toBe(1);
    expect(pickled.score).toBeLessThan(MIN_CONFIDENCE);
    expect(ranked[0]!.score - ranked[1]!.score).toBeGreaterThan(0.25);
  });

  it("ranks raw beef above the canned/stewed jar", () => {
    const beef = entry({ slug: "beef_stewing", nameUk: "Яловичина", category: "meat" });
    const ranked = rankCandidates(beef, 500, [
      sku({ productId: "raw", name: "Яловичина лопатка", packSize: "1кг", weighted: true }),
      sku({ productId: "canned", name: "Яловичина тушкована Гост", packSize: "525г", price: 120 }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("raw");
    expect(ranked.find((r) => r.candidate.productId === "canned")!.score).toBeLessThan(
      MIN_CONFIDENCE,
    );
  });

  it("prefers a 1 kg salt over a 90 g premium mill for a 30 g need (pantry pack fit + ₴/kg)", () => {
    const salt = entry({ slug: "salt", nameUk: "Сіль", category: "pantry" });
    const ranked = rankCandidates(salt, 30, [
      sku({ productId: "kg", name: "Сіль кухонна йодована", packSize: "1кг", price: 25 }),
      sku({ productId: "kg2", name: "Сіль кам'яна", packSize: "1кг", price: 18 }),
      sku({ productId: "mill", name: "Сіль Kamis морська млинок", packSize: "90г", price: 159 }),
    ]);
    expect(ranked[0]!.candidate.productId).toBe("kg2");
    expect(
      ranked.find((r) => r.candidate.productId === "kg")!.breakdown.packFit,
    ).toBeGreaterThanOrEqual(0.7);
    expect(ranked.find((r) => r.candidate.productId === "mill")!.breakdown.priceOutlier).toBe(-1);
    expect(ranked.find((r) => r.candidate.productId === "mill")!.score).toBeLessThan(
      MIN_CONFIDENCE,
    );
  });

  it("pushes an expensive premium butter below the cheaper ones (₴/kg outlier)", () => {
    const butter = entry({ slug: "butter", nameUk: "Масло вершкове", category: "dairy_eggs" });
    const ranked = rankCandidates(butter, 50, [
      sku({ productId: "std", name: "Масло солодковершкове 72,5%", packSize: "200г", price: 75 }),
      sku({ productId: "budget", name: "Масло селянське 73%", packSize: "200г", price: 62 }),
      sku({ productId: "premium", name: "Масло Paysan Breton 82%", packSize: "200г", price: 199 }),
    ]);
    expect(ranked[0]!.candidate.productId).not.toBe("premium");
    expect(ranked.find((r) => r.candidate.productId === "premium")!.breakdown.priceOutlier).toBe(
      -1,
    );
  });

  it("isWrongForm flags wrong preparations per category", () => {
    expect(isWrongForm("meat", "Яловичина тушкована Гост")).toBe(true);
    expect(isWrongForm("meat", "Яловичина обJerky в'ялена")).toBe(true);
    expect(isWrongForm("meat", "Біфштекс «М'ясторія» з яловичини шок-фриз")).toBe(true);
    expect(isWrongForm("meat", "Яловичина лопатка охолоджена")).toBe(false);
    expect(isWrongForm("vegetable", "Перець солодкий маринований")).toBe(true);
    expect(isWrongForm("vegetable", "Перець солодкий")).toBe(false);
    expect(isWrongForm("pantry", "Сіль тушкована")).toBe(false); // no form list for pantry
  });

  it("does not penalise frozen spinach (conservative form list)", () => {
    const spinach = entry({ slug: "spinach", nameUk: "Шпинат", category: "vegetable" });
    const ranked = rankCandidates(spinach, 150, [
      sku({ productId: "frozen", name: "Шпинат заморожений", packSize: "400г", price: 45 }),
    ]);
    expect(ranked[0]!.breakdown.form).toBe(0);
  });
});
