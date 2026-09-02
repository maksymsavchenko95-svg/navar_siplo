import { describe, expect, it } from "vitest";

import { mapSkuAllergens, normalizeAllergenToken, scanCompositionText } from "./allergens.js";

describe("normalizeAllergenToken", () => {
  it("uppercases, folds ё, strips punctuation and spaces", () => {
    expect(normalizeAllergenToken(" глютен ")).toBe("ГЛЮТЕН");
    expect(normalizeAllergenToken("діоксид сірки (Е220)")).toBe("ДІОКСИДСІРКИЕ220");
  });
});

describe("mapSkuAllergens", () => {
  it("maps the structured `Містить алергени` tokens to EU-14 codes", () => {
    expect(mapSkuAllergens(["ГЛЮТЕН", "ПШЕНИЦЯ"]).codes).toEqual(["gluten"]);
    expect(mapSkuAllergens(["МОЛОКО"]).codes).toEqual(["milk"]);
    expect(mapSkuAllergens(["ЯЙЦЯ", "ГІРЧИЦЯ"]).codes).toEqual(["egg", "mustard"].sort());
  });

  it("catches allergen words inline in a Склад token", () => {
    expect(mapSkuAllergens(["борошно ЖИТНЄ обдирне"]).codes).toEqual(["gluten"]);
    expect(mapSkuAllergens(["клейковину ПШЕНИЧНУ суху"]).codes).toEqual(["gluten"]);
  });

  it("returns unmapped tokens in `unknown`, not silently dropped", () => {
    const out = mapSkuAllergens(["БАРВНИК Е160", "ГЛЮТЕН"]);
    expect(out.codes).toEqual(["gluten"]);
    expect(out.unknown).toContain("БАРВНИКЕ160");
  });

  it("is deterministic and sorted", () => {
    const a = mapSkuAllergens(["МОЛОКО", "ГЛЮТЕН", "СОЯ"]);
    const b = mapSkuAllergens(["СОЯ", "ГЛЮТЕН", "МОЛОКО"]);
    expect(a).toEqual(b);
    expect(a.codes).toEqual(["gluten", "milk", "soybeans"]);
  });
});

describe("scanCompositionText", () => {
  it("finds allergens named only in the Склад free-text", () => {
    expect(scanCompositionText("Борошно пшеничне, вода, сіль, дріжджі").codes).toEqual(["gluten"]);
    expect(scanCompositionText("вершкове масло, цукор, сухе знежирене молоко").codes).toEqual([
      "milk",
    ]);
    expect(scanCompositionText("вода, соєвий соус, кунжутна олія").codes).toEqual(
      ["sesame", "soybeans"].sort(),
    );
  });

  it("returns no codes for a composition with no allergens", () => {
    expect(scanCompositionText("вода, морква, цибуля, сіль").codes).toEqual([]);
  });

  it("is order-independent and sorted", () => {
    expect(scanCompositionText("молоко, пшениця").codes).toEqual(
      scanCompositionText("пшениця, молоко").codes,
    );
  });
});
