import type { ProductDetails } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { assertSkuSafe, checkIngredient, checkSku, needsSkuCheck, SafetyError } from "./check.js";
import type { Exclusions } from "./restrictions.js";

const GLUTEN: Exclusions = { allergens: ["gluten"], ingredients: [], strictMode: false };
const NONE: Exclusions = { allergens: [], ingredients: [], strictMode: false };

const details = (over: Partial<ProductDetails>): ProductDetails => ({
  slug: "x",
  name: "X",
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

describe("checkIngredient", () => {
  it("blocks an ingredient whose allergen union hits a declared allergy", () => {
    const v = checkIngredient({ slug: "wheat_flour", allergens: ["gluten"], exclusions: GLUTEN });
    expect(v).toMatchObject({ safe: false, source: "ingredient", allergens: ["gluten"] });
    if (!v.safe) expect(v.reason).toMatch(/глютен/);
  });

  it("passes a clean ingredient", () => {
    expect(checkIngredient({ slug: "carrot", allergens: [], exclusions: GLUTEN })).toEqual({
      safe: true,
    });
  });

  it("blocks an ingredient on the strict-dislike exclusion list", () => {
    const v = checkIngredient({
      slug: "mushroom",
      allergens: [],
      exclusions: { allergens: [], ingredients: ["mushroom"], strictMode: false },
    });
    expect(v.safe).toBe(false);
  });
});

describe("needsSkuCheck", () => {
  it("is true only for allergen-risk categories with a declared allergy", () => {
    expect(needsSkuCheck("pantry", GLUTEN)).toBe(true);
    expect(needsSkuCheck("spice_herb", GLUTEN)).toBe(true);
    expect(needsSkuCheck("vegetable", GLUTEN)).toBe(false);
    expect(needsSkuCheck("pantry", NONE)).toBe(false);
  });
});

describe("checkSku — fail-closed (ADR-05)", () => {
  it("blocks when the SKU declares the allergen", () => {
    const v = checkSku({ details: details({ allergens: ["ГЛЮТЕН"] }), exclusions: GLUTEN });
    expect(v).toMatchObject({ safe: false, source: "sku", allergens: ["gluten"] });
  });

  it("blocks when there is no composition data and an allergy is declared", () => {
    const v = checkSku({
      details: details({ allergens: [], composition: null }),
      exclusions: GLUTEN,
    });
    expect(v).toMatchObject({ safe: false, source: "sku_unknown" });
  });

  it("blocks on an unmappable allergen token next to a declared allergy", () => {
    const v = checkSku({ details: details({ allergens: ["ЩОСЬ НЕВІДОМЕ"] }), exclusions: GLUTEN });
    expect(v).toMatchObject({ safe: false, source: "sku_unknown" });
  });

  it("passes a SKU that clearly carries a different allergen only", () => {
    const v = checkSku({ details: details({ allergens: ["МОЛОКО"] }), exclusions: GLUTEN });
    expect(v).toEqual({ safe: true });
  });

  it("blocks on an allergen named only in the composition, structured list empty (F1)", () => {
    const v = checkSku({
      details: details({
        allergens: [],
        composition: "борошно пшеничне, вода, сіль, дріжджі",
      }),
      exclusions: GLUTEN,
    });
    expect(v).toMatchObject({ safe: false, source: "sku", allergens: ["gluten"] });
  });

  it("passes when the composition is present and names no declared allergen", () => {
    const v = checkSku({
      details: details({ allergens: [], composition: "вода, морква, цибуля, сіль" }),
      exclusions: GLUTEN,
    });
    expect(v).toEqual({ safe: true });
  });

  it("passes any SKU when the household declares no allergy", () => {
    expect(checkSku({ details: details({ allergens: [] }), exclusions: NONE })).toEqual({
      safe: true,
    });
  });

  it("strictMode blocks a clean SKU whose composition is still unknown", () => {
    const strict: Exclusions = { ...GLUTEN, strictMode: true };
    const v = checkSku({
      details: details({ allergens: ["МОЛОКО"], composition: null }),
      exclusions: strict,
    });
    expect(v).toMatchObject({ safe: false, source: "sku_unknown" });
  });
});

describe("assertSkuSafe", () => {
  it("throws SafetyError carrying the verdict", () => {
    try {
      assertSkuSafe({ details: details({ allergens: ["ГЛЮТЕН"] }), exclusions: GLUTEN });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SafetyError);
      expect((err as SafetyError).verdict.source).toBe("sku");
    }
  });

  it("does not throw for a safe SKU", () => {
    expect(() =>
      assertSkuSafe({ details: details({ allergens: ["МОЛОКО"] }), exclusions: GLUTEN }),
    ).not.toThrow();
  });
});
