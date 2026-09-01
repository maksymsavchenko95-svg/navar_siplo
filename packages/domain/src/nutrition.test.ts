import { describe, expect, it } from "vitest";

import { nutritionTargetsSchema } from "./schemas.js";
import {
  assertKcalFloor,
  computeNutritionTargets,
  KCAL_FLOOR,
  KcalFloorError,
  type NutritionComputedFrom,
  parseKcal,
  rawKcalTarget,
  recipeMacros,
  scaleMacros,
} from "./nutrition.js";

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

describe("computeNutritionTargets", () => {
  // The demo household in packages/db/src/seed.ts — kept in sync there via the same fn.
  const SEED_PERSONA: NutritionComputedFrom = {
    sex: "male",
    ageYears: 32,
    weightKg: 78,
    heightCm: 182,
    activity: "moderate",
    direction: "gain",
  };

  it("computes Mifflin–St Jeor BMR, TDEE and the direction-adjusted target", () => {
    const t = computeNutritionTargets(SEED_PERSONA);
    // BMR = 10·78 + 6.25·182 − 5·32 + 5 = 1762.5 ; TDEE = ·1.55 ; target = ·1.12
    expect(t.bmr).toBe(1763);
    expect(t.tdee).toBe(2732);
    expect(t.kcalTarget).toBe(3060);
    expect(t.proteinMinG).toBe(140); // 78 × 1.8
    expect(t.kcalTolerance).toBe(0.15);
    expect(t.direction).toBe("gain");
    expect(t.computedFrom).toEqual(SEED_PERSONA);
  });

  it("uses the female BMR constant (−161)", () => {
    const t = computeNutritionTargets({
      sex: "female",
      ageYears: 30,
      weightKg: 62,
      heightCm: 168,
      activity: "light",
      direction: "maintain",
    });
    // BMR = 620 + 1050 − 150 − 161 = 1359 ; TDEE = ·1.375 = 1868.6 ; maintain ×1.0
    expect(t.bmr).toBe(1359);
    expect(t.kcalTarget).toBe(1869);
    expect(t.proteinMinG).toBe(99); // 62 × 1.6
  });

  it("orders kcal gain > maintain > reduce and protein reduce > gain > maintain", () => {
    const base = {
      sex: "male",
      ageYears: 40,
      weightKg: 80,
      heightCm: 178,
      activity: "moderate",
    } as const;
    const gain = computeNutritionTargets({ ...base, direction: "gain" });
    const maintain = computeNutritionTargets({ ...base, direction: "maintain" });
    const reduce = computeNutritionTargets({ ...base, direction: "reduce" });

    expect(gain.kcalTarget).toBeGreaterThan(maintain.kcalTarget);
    expect(maintain.kcalTarget).toBeGreaterThan(reduce.kcalTarget);
    expect(reduce.proteinMinG).toBeGreaterThan(gain.proteinMinG);
    expect(gain.proteinMinG).toBeGreaterThan(maintain.proteinMinG);
  });

  it("is deterministic — same metrics, deep-equal result (FR-PLAN-005 discipline)", () => {
    expect(computeNutritionTargets(SEED_PERSONA)).toEqual(computeNutritionTargets(SEED_PERSONA));
  });

  it("fails closed on a sub-floor target — throws, never returns a clamped 1200", () => {
    const tiny: NutritionComputedFrom = {
      sex: "female",
      ageYears: 30,
      weightKg: 45,
      heightCm: 158,
      activity: "sedentary",
      direction: "reduce",
    };
    // raw target ≈ round(1126.5 · 1.2 · 0.85) = 1149 < 1200
    expect(rawKcalTarget(tiny)).toBeLessThan(KCAL_FLOOR);
    expect(() => computeNutritionTargets(tiny)).toThrow(KcalFloorError);
  });

  it("produces output that satisfies nutritionTargetsSchema (bmr/tdee stripped)", () => {
    const parsed = nutritionTargetsSchema.parse(computeNutritionTargets(SEED_PERSONA));
    expect(parsed).not.toHaveProperty("bmr");
    expect(parsed.kcalTarget).toBe(3060);
  });
});

describe("parseKcal", () => {
  it("takes the first number of a kcal/kJ string", () => {
    expect(parseKcal("189/801")).toBe(189);
  });
  it("handles a bare number", () => {
    expect(parseKcal("189")).toBe(189);
  });
  it("tolerates a decimal comma and whitespace", () => {
    expect(parseKcal(" 189,5 / 801 ")).toBe(189.5);
  });
  it("returns null for empty / non-numeric input", () => {
    expect(parseKcal("")).toBeNull();
    expect(parseKcal("н/д")).toBeNull();
    expect(parseKcal("/801")).toBeNull();
  });
});
