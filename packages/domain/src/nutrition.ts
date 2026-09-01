/**
 * Nutrition — deterministic macro math for the `form` goal mode (TDD v0.2 §4, ADR-09).
 * Never the LLM (ADR-02). Recipe macros are computed from ingredient macros + grams;
 * portion is a lever (0.6–1.4×) the solver uses instead of dropping a dish (`FR-GOAL-007`).
 */

import { z } from "zod";

export type Goal = "routine" | "form";
export type GoalDirection = "gain" | "maintain" | "reduce";

/**
 * Where a per-100 g macro figure came from (`Q-09`, `nutrition_src` column):
 * `catalog` — read off a Silpo SKU card; `reference` — a food-composition table
 * (weighed produce / meat / grains that don't carry card macros); `estimated` — interpolated.
 */
export const nutritionSourceSchema = z.enum(["catalog", "reference", "estimated"]);
export type NutritionSource = z.infer<typeof nutritionSourceSchema>;

export interface Macros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
}

/**
 * Per-100 g macro profile for a `CanonicalIngredient`. Unlike `servingMacrosSchema`
 * (what the guest sees), `fiber` is required — the reference dictionary always carries it,
 * since Silpo cards never do (M0 audit follow-up #3).
 */
export const macros100Schema = z.object({
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
});
export type Macros100 = z.infer<typeof macros100Schema>;

/**
 * Parse a Silpo catalog `Енергетична цінність` attribute — a `"kcal/kJ"` string such as
 * `"189/801"` (M0 audit follow-up #3). Takes the first number; tolerates a decimal comma
 * and surrounding whitespace. Returns `null` for empty / `"н/д"` / unparseable input so
 * callers can fall back to the reference table rather than trust a bad figure.
 */
export function parseKcal(raw: string): number | null {
  const first = raw.split("/")[0]?.trim().replace(",", ".");
  if (!first) return null;
  const n = Number.parseFloat(first);
  return Number.isFinite(n) ? n : null;
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

// ─── Nutrition targets from body metrics (FR-GOAL-003, household.computeNutrition) ─────

/** Activity level → TDEE multiplier applied to the Mifflin–St Jeor BMR. */
export const ACTIVITY_FACTOR: Record<NutritionComputedFrom["activity"], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Goal direction → kcal adjustment on TDEE. Deliberately gentle — `form` is a goal, not
 *  a treatment (`.claude/rules/food-safety.md`). Tune here, not at call sites. */
export const DIRECTION_KCAL_FACTOR: Record<GoalDirection, number> = {
  gain: 1.12,
  maintain: 1.0,
  reduce: 0.85,
};

/** Goal direction → daily protein floor, grams per kg of body weight. */
export const DIRECTION_PROTEIN_G_PER_KG: Record<GoalDirection, number> = {
  gain: 1.8,
  maintain: 1.6,
  reduce: 2.0,
};

/** Half-width of the calorie corridor as a fraction of the target (TDD v0.2 §4, ±15%). */
export const KCAL_TOLERANCE = 0.15;

/** Output of {@link computeNutritionTargets} — a superset of the persisted `nutrition_targets`
 *  columns (`bmr` / `tdee` are kept for the future plan explainer, not stored). */
export interface NutritionTargetsComputation {
  proteinMinG: number;
  /** Centre of the calorie corridor (kcal). Never below {@link KCAL_FLOOR}. */
  kcalTarget: number;
  kcalTolerance: number;
  direction: GoalDirection;
  computedFrom: NutritionComputedFrom;
  /** Basal metabolic rate, kcal/day (Mifflin–St Jeor). */
  bmr: number;
  /** Total daily energy expenditure before the direction adjustment, kcal/day. */
  tdee: number;
}

/** Mifflin–St Jeor basal metabolic rate, kcal/day. */
function mifflinStJeorBmr(m: NutritionComputedFrom): number {
  return 10 * m.weightKg + 6.25 * m.heightCm - 5 * m.ageYears + (m.sex === "male" ? 5 : -161);
}

/**
 * The calorie-corridor centre *before* the `FR-SAFE-009` floor check. Exposed so a caller
 * that gets a {@link KcalFloorError} can still report the raw figure it rejected.
 */
export function rawKcalTarget(m: NutritionComputedFrom): number {
  const tdee = mifflinStJeorBmr(m) * ACTIVITY_FACTOR[m.activity];
  return Math.round(tdee * DIRECTION_KCAL_FACTOR[m.direction]);
}

/**
 * `FR-GOAL-003` — body metrics → a `form` household's nutrition targets. Deterministic:
 * same metrics → same targets (no RNG, no clock). Fail-closed: throws {@link KcalFloorError}
 * (its message is the reason) when the computed target is below {@link KCAL_FLOOR}, so the
 * caller **rejects** the request rather than clamping it (`FR-SAFE-009`). Targets are
 * computed by the system, never entered by the guest.
 */
export function computeNutritionTargets(m: NutritionComputedFrom): NutritionTargetsComputation {
  const bmr = mifflinStJeorBmr(m);
  const tdee = bmr * ACTIVITY_FACTOR[m.activity];
  const kcalTarget = Math.round(tdee * DIRECTION_KCAL_FACTOR[m.direction]);
  assertKcalFloor(kcalTarget);
  return {
    proteinMinG: Math.round(m.weightKg * DIRECTION_PROTEIN_G_PER_KG[m.direction]),
    kcalTarget,
    kcalTolerance: KCAL_TOLERANCE,
    direction: m.direction,
    computedFrom: m,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
  };
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
