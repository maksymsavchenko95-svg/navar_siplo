/**
 * Nutrition — deterministic macro math for the `form` goal mode (TDD v0.2 §4, ADR-09).
 * Never the LLM (ADR-02). Recipe macros are computed from ingredient macros + grams;
 * portion is a lever (0.6–1.4×) the solver uses instead of dropping a dish (`FR-GOAL-007`).
 */

export type Goal = "routine" | "form";
export type GoalDirection = "gain" | "maintain" | "reduce";
export type NutritionSource = "catalog" | "reference" | "estimated";

export interface Macros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
}

/** Body metrics an `form` household's targets are derived from (`FR-GOAL-003`). */
export interface NutritionComputedFrom {
  sex: "male" | "female";
  ageYears: number;
  weightKg: number;
  heightCm: number;
  activity: "sedentary" | "light" | "moderate" | "active" | "very_active";
  direction: GoalDirection;
}

/** `FR-SAFE-009` — a `form` calorie target can never sit below this. Mirrors the DB CHECK. */
export const KCAL_FLOOR = 1200;

export class KcalFloorError extends Error {
  constructor(kcalTarget: number) {
    super(`kcal target ${kcalTarget} is below the ${KCAL_FLOOR} kcal floor (FR-SAFE-009)`);
    this.name = "KcalFloorError";
  }
}

/** Fail closed: reject a sub-floor target, never clamp it silently. */
export function assertKcalFloor(kcalTarget: number): void {
  if (!Number.isFinite(kcalTarget) || kcalTarget < KCAL_FLOOR) {
    throw new KcalFloorError(kcalTarget);
  }
}

const ZERO: Macros = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };

/** Macros contributed by `grams` of an ingredient given its per-100g profile. */
export function scaleMacros(per100g: Macros, grams: number, portionScale = 1): Macros {
  const f = (grams / 100) * portionScale;
  return {
    kcal: per100g.kcal * f,
    protein: per100g.protein * f,
    fat: per100g.fat * f,
    carbs: per100g.carbs * f,
    fiber: (per100g.fiber ?? 0) * f,
  };
}

function add(a: Macros, b: Macros): Macros {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    fat: a.fat + b.fat,
    carbs: a.carbs + b.carbs,
    fiber: (a.fiber ?? 0) + (b.fiber ?? 0),
  };
}

/**
 * Per-serving macros for a recipe. `lines` carry each ingredient's per-100g profile and
 * its total grams in the recipe (callers convert `amount`+`unit`→grams via `units.ts`).
 */
export function recipeMacros(
  lines: { per100g: Macros; grams: number }[],
  servings: number,
  portionScale = 1,
): Macros {
  if (servings <= 0) throw new Error("servings must be positive");
  const total = lines.reduce((acc, l) => add(acc, scaleMacros(l.per100g, l.grams, portionScale)), {
    ...ZERO,
  });
  return {
    kcal: total.kcal / servings,
    protein: total.protein / servings,
    fat: total.fat / servings,
    carbs: total.carbs / servings,
    fiber: (total.fiber ?? 0) / servings,
  };
}
