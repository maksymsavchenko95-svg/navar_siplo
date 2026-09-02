import { describe, expect, it } from "vitest";

import { mapSkuAllergens, normalizeAllergenToken } from "./allergens.js";

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
