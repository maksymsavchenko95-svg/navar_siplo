import { describe, expect, it } from "vitest";

import { canonicalIngredientSchema } from "./schemas.js";

const VALID = {
  slug: "chicken_breast",
  nameUk: "Куряче філе",
  category: "meat",
  baseUnit: "g",
  allergens: [],
  synonyms: ["філе куряче"],
  perishableDays: 3,
  per100g: { kcal: 120, protein: 23, fat: 2.6, carbs: 0, fiber: 0 },
  nutritionSrc: "reference",
} as const;

describe("canonicalIngredientSchema", () => {
  it("accepts a full valid entry and defaults the optional fields", () => {
    const parsed = canonicalIngredientSchema.parse({
      slug: "salt",
      nameUk: "Сіль",
      category: "pantry",
      baseUnit: "g",
    });
    expect(parsed.allergens).toEqual([]);
    expect(parsed.synonyms).toEqual([]);
    expect(parsed.densityGMl).toBeNull();
    expect(parsed.gramsPerPiece).toBeNull();
    expect(parsed.per100g).toBeNull();
    expect(parsed.nutritionSrc).toBeNull();
  });

  it("accepts the reference profile", () => {
    expect(canonicalIngredientSchema.parse(VALID)).toMatchObject({ slug: "chicken_breast" });
  });

  it("rejects an unknown allergen code", () => {
    expect(() => canonicalIngredientSchema.parse({ ...VALID, allergens: ["shellfish"] })).toThrow();
  });

  it("rejects a slug that is not lower_snake_case", () => {
    expect(() => canonicalIngredientSchema.parse({ ...VALID, slug: "Chicken Breast" })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() => canonicalIngredientSchema.parse({ ...VALID, category: "dairy" })).toThrow();
  });

  it("requires nutritionSrc when per100g is set", () => {
    const { nutritionSrc: _drop, ...noSrc } = VALID;
    expect(() => canonicalIngredientSchema.parse(noSrc)).toThrow(/nutritionSrc/);
  });

  it("requires gramsPerPiece for a pcs ingredient that carries macros", () => {
    expect(() =>
      canonicalIngredientSchema.parse({
        slug: "egg",
        nameUk: "Яйця",
        category: "dairy_eggs",
        baseUnit: "pcs",
        allergens: ["egg"],
        per100g: { kcal: 143, protein: 13, fat: 9.5, carbs: 0.7, fiber: 0 },
        nutritionSrc: "reference",
      }),
    ).toThrow(/gramsPerPiece/);
  });

  it("accepts a pcs ingredient with macros once gramsPerPiece is given", () => {
    expect(
      canonicalIngredientSchema.parse({
        slug: "egg",
        nameUk: "Яйця",
        category: "dairy_eggs",
        baseUnit: "pcs",
        gramsPerPiece: 50,
        allergens: ["egg"],
        per100g: { kcal: 143, protein: 13, fat: 9.5, carbs: 0.7, fiber: 0 },
        nutritionSrc: "reference",
      }),
    ).toMatchObject({ gramsPerPiece: 50 });
  });
});
