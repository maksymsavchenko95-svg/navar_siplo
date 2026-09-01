import { describe, expect, it } from "vitest";

import { recipeIngredientRefSchema, recipeSeedSchema } from "./schemas.js";

const VALID = {
  slug: "chicken_buckwheat_broccoli",
  titleUk: "Курка з гречкою та броколі",
  servings: 4,
  activeMinutes: 20,
  totalMinutes: 40,
  difficulty: 2,
  mealType: "dinner",
  seasons: ["autumn", "winter"],
  tags: ["kids_friendly", "reheatable"],
  steps: ["Відварити гречку.", "Обсмажити курку, з'єднати з гречкою та броколі."],
  ingredients: [
    { slug: "chicken_breast", amount: 600, unit: "g" },
    { slug: "buckwheat_groats", amount: 300, unit: "g" },
    { slug: "broccoli", amount: 400, unit: "g" },
    { slug: "sunflower_oil", amount: 30, unit: "ml", optional: true },
  ],
} as const;

describe("recipeIngredientRefSchema", () => {
  it("defaults optional to false", () => {
    const parsed = recipeIngredientRefSchema.parse({ slug: "carrot", amount: 200, unit: "g" });
    expect(parsed.optional).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    expect(() =>
      recipeIngredientRefSchema.parse({ slug: "carrot", amount: 0, unit: "g" }),
    ).toThrow();
  });

  it("rejects an unknown unit", () => {
    expect(() =>
      recipeIngredientRefSchema.parse({ slug: "carrot", amount: 1, unit: "cup" }),
    ).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() =>
      recipeIngredientRefSchema.parse({ slug: "carrot", amount: 1, unit: "g", note: "x" }),
    ).toThrow();
  });
});

describe("recipeSeedSchema", () => {
  it("accepts a full valid entry and defaults tags", () => {
    const parsed = recipeSeedSchema.parse({ ...VALID, tags: undefined });
    expect(parsed.tags).toEqual([]);
    expect(parsed.ingredients[0]).toMatchObject({ slug: "chicken_breast", optional: false });
  });

  it("rejects a slug that is not lower_snake_case", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, slug: "Chicken Plov" })).toThrow(/lower_snake/);
  });

  it("rejects difficulty outside 1..3", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, difficulty: 0 })).toThrow();
    expect(() => recipeSeedSchema.parse({ ...VALID, difficulty: 4 })).toThrow();
  });

  it("rejects empty steps and empty ingredients", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, steps: [] })).toThrow();
    expect(() => recipeSeedSchema.parse({ ...VALID, ingredients: [] })).toThrow();
  });

  it("rejects an unknown tag", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, tags: ["fitness"] })).toThrow();
  });

  it("requires at least one season", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, seasons: [] })).toThrow();
  });

  it("rejects totalMinutes below activeMinutes", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, activeMinutes: 50, totalMinutes: 30 })).toThrow(
      /totalMinutes/,
    );
  });

  it("rejects a hand-set allergens key (strict — computed on import)", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, allergens: ["milk"] })).toThrow();
  });

  it("rejects a hand-set kcalServing key (strict — computed on import)", () => {
    expect(() => recipeSeedSchema.parse({ ...VALID, kcalServing: 500 })).toThrow();
  });

  it("rejects a duplicate ingredient slug within one recipe", () => {
    expect(() =>
      recipeSeedSchema.parse({
        ...VALID,
        ingredients: [
          { slug: "carrot", amount: 100, unit: "g" },
          { slug: "carrot", amount: 50, unit: "g" },
        ],
      }),
    ).toThrow(/duplicate ingredient slug/);
  });
});
