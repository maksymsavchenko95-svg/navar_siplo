import type { Goal, Macros } from "@navar/domain";

/**
 * @navar/planner — deterministic solver + the LLM planning layer. Picks a combination of
 * recipes that satisfies every hard constraint and maximises the soft goals in weight
 * order. Same inputs + same seed → same plan; cost is computed in pack sizes, not grams.
 *
 * Spec: TDD v0.2 §4, SRS §6.5. The solver is deterministic code (ADR-02/03); only dish
 * generation, re-ranking and explanations touch the LLM.
 *
 * ── ADR-09 ────────────────────────────────────────────────────────────────────
 * `routine` and `form` are ONE solver. The goal mode enters only through `SolverInput`
 * — two optional hard constraints (`proteinMinPerDay`, `kcalRange`) and the `weights`
 * profile. There must be no `if (goal === 'form')` anywhere below the construction of
 * `SolverInput`, and `Recipe` carries no "fitness" tag — form-mode suitability is
 * computed from macros + portion.
 */

export interface SolverWeights {
  promo: number;
  pantry: number;
  reuse: number;
  brand: number;
  recency: number; // negative
  cost: number; // negative
  proteinPerUah: number; // form only (0 for routine)
  veg: number; // form only (0 for routine)
}

/** The two weight profiles from TDD v0.2 §4. */
export const WEIGHTS: Record<Goal, SolverWeights> = {
  routine: {
    promo: 3.0,
    pantry: 2.0,
    reuse: 1.5,
    brand: 1.0,
    recency: -2.0,
    cost: -1.0,
    proteinPerUah: 0,
    veg: 0,
  },
  form: {
    promo: 2.0,
    pantry: 1.5,
    reuse: 1.0,
    brand: 0.5,
    recency: -2.0,
    cost: -1.0,
    proteinPerUah: 2.5,
    veg: 1.5,
  },
};

/** Present only when `goal === 'form'`; `undefined` means the constraint is inactive. */
export interface SolverGoalConstraints {
  proteinMinPerDay?: number; // grams
  kcalRange?: [number, number]; // [min, max]; min ≥ KCAL_FLOOR
}

export interface RecipeCandidate {
  recipeId: string;
  servings: number;
  activeMinutes: number;
  ingredientIds: string[];
  macrosPerServing: Macros;
}

export interface SolverInput {
  seed: number;
  days: number;
  budget: number; // ₴
  servings: number; // from household_members
  goal: Goal;
  hardConstraints: {
    excludedAllergens: string[];
    excludedIngredients: string[];
    maxActiveMinutes: number;
  } & SolverGoalConstraints;
  weights: SolverWeights;
  candidates: RecipeCandidate[];
  prices: Map<string, { uah: number; promo: boolean; packSize: number }>;
  nutrition: Map<string, Macros>; // per 100 g, by ingredient id
  pantry: Map<string, number>; // P1; empty in P0
  recentRecipeIds: string[]; // last 4 weeks
}

export function generatePlan(_input: SolverInput): never {
  throw new Error("planner not implemented — P0 (TDD v0.2 §4, ADR-09)");
}
