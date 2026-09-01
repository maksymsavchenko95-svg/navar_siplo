import { describe, expect, it } from "vitest";

import { assertKcalFloor, KcalFloorError, recipeMacros, scaleMacros } from "./nutrition.js";

const CHICKEN = { kcal: 165, protein: 31, fat: 3.6, carbs: 0 }; // per 100 g

describe("scaleMacros", () => {
  it("scales by grams", () => {
    expect(scaleMacros(CHICKEN, 200)).toMatchObject({ kcal: 330, protein: 62 });
  });
  it("applies portionScale", () => {
    expect(scaleMacros(CHICKEN, 200, 0.5)).toMatchObject({ kcal: 165, protein: 31 });
  });
});

describe("recipeMacros", () => {
  it("sums lines and divides by servings", () => {
    const m = recipeMacros(
      [
        { per100g: CHICKEN, grams: 400 },
        { per100g: { kcal: 130, protein: 2.7, fat: 0.3, carbs: 28 }, grams: 300 }, // rice
      ],
      4,
    );
    expect(m.kcal).toBeCloseTo((165 * 4 + 130 * 3) / 4);
    expect(m.protein).toBeCloseTo((31 * 4 + 2.7 * 3) / 4);
  });

  it("scales the whole recipe by portionScale", () => {
    const base = recipeMacros([{ per100g: CHICKEN, grams: 400 }], 2);
    const scaled = recipeMacros([{ per100g: CHICKEN, grams: 400 }], 2, 1.4);
    expect(scaled.kcal).toBeCloseTo(base.kcal * 1.4);
  });
});

describe("assertKcalFloor", () => {
  it("throws below the floor", () => {
    expect(() => assertKcalFloor(1000)).toThrow(KcalFloorError);
  });
  it("passes at or above the floor", () => {
    expect(() => assertKcalFloor(1200)).not.toThrow();
    expect(() => assertKcalFloor(2400)).not.toThrow();
  });
});
