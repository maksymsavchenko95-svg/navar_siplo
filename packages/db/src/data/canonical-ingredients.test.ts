import { canonicalIngredientSchema } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { CANONICAL_INGREDIENTS } from "./canonical-ingredients.js";

/** Ingredients the P0 demo recipes (and the corpus to come) must be able to resolve. */
const MUST_HAVE = [
  "chicken_breast",
  "rice_long_grain",
  "carrot",
  "onion",
  "potato",
  "egg",
  "sunflower_oil",
  "milk",
  "wheat_flour",
  "buckwheat_groats",
  "salt",
  "sugar",
];

describe("CANONICAL_INGREDIENTS", () => {
  it("every entry passes canonicalIngredientSchema", () => {
    for (const entry of CANONICAL_INGREDIENTS) {
      expect(() => canonicalIngredientSchema.parse(entry), entry.slug).not.toThrow();
    }
  });

  it("has unique slugs", () => {
    const slugs = CANONICAL_INGREDIENTS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("100% define an allergens array and a base unit", () => {
    for (const e of CANONICAL_INGREDIENTS) {
      expect(Array.isArray(e.allergens), e.slug).toBe(true);
      expect(["g", "ml", "pcs"], e.slug).toContain(e.baseUnit);
    }
  });

  it("at least 90% carry per-100 g macros", () => {
    const withMacros = CANONICAL_INGREDIENTS.filter((e) => e.per100g != null).length;
    expect(withMacros / CANONICAL_INGREDIENTS.length).toBeGreaterThanOrEqual(0.9);
  });

  it("every macro-bearing entry declares a nutrition source", () => {
    for (const e of CANONICAL_INGREDIENTS) {
      if (e.per100g != null) expect(e.nutritionSrc, e.slug).not.toBeNull();
    }
  });

  it("contains every must-have ingredient", () => {
    const slugs = new Set(CANONICAL_INGREDIENTS.map((e) => e.slug));
    for (const slug of MUST_HAVE) expect(slugs, slug).toContain(slug);
  });

  it("gives every pcs ingredient a grams-per-piece weight", () => {
    for (const e of CANONICAL_INGREDIENTS) {
      if (e.baseUnit === "pcs") expect(e.gramsPerPiece, e.slug).toBeTypeOf("number");
    }
  });
});
