import type { BaseUnit, Goal, IngredientCategory, Macros } from "@navar/domain";

/**
 * `@navar/planner` contract (TDD v0.2 §4, SRS §6.5, ADR-02/03/09). The solver picks a
 * combination of recipes that satisfies every hard constraint and maximises the soft goals
 * in weight order. Same inputs + same seed → same plan; cost is computed in pack sizes, not
 * grams (`NFR-DATA-003`). Deterministic code — only dish generation / re-ranking /
 * explanations touch the LLM.
 *
 * ── ADR-09 ────────────────────────────────────────────────────────────────────
 * `routine` and `form` are ONE solver. The goal mode enters only through `SolverInput`
 * — two optional hard constraints (`proteinMinPerDay`, `kcalRange`) and the `weights`
 * profile. There is no `if (goal === 'form')` anywhere below the construction of
 * `SolverInput`, and `RecipeCandidate` carries no "fitness" tag.
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
  proteinMinPerDay?: number; // grams, per dinner (the assembler scales the daily target)
  kcalRange?: [number, number]; // [min, max] per dinner; min ≥ KCAL_FLOOR at the daily level
}

/** One recipe line — `amount` already in the ingredient's base unit (assembler converts). */
export interface RecipeIngredientLine {
  id: string; // canonical_ingredients.id (uuid) — the key space of `prices` / `nutrition`
  amount: number;
  unit: BaseUnit;
  category: IngredientCategory;
  optional: boolean;
}

export interface RecipeCandidate {
  recipeId: string;
  slug: string;
  titleUk: string;
  servings: number; // the recipe's own yield
  activeMinutes: number;
  ingredients: RecipeIngredientLine[];
  macrosPerServing: Macros; // computed at import — the solver never recomputes it
}

export interface SolverInput {
  seed: number;
  days: number; // 5
  budget: number; // ₴
  servings: number; // household size (adults + children)
  goal: Goal;
  hardConstraints: {
    excludedAllergens: string[]; // EU-14 codes (enforced upstream via recipes.allergens)
    excludedIngredients: string[]; // canonical_ingredients.id
    maxActiveMinutes: number;
  } & SolverGoalConstraints;
  weights: SolverWeights;
  candidates: RecipeCandidate[];
  prices: Map<string, { uah: number; promo: boolean; packSize: number }>; // by ingredient id
  nutrition: Map<string, Macros>; // per 100 g, by ingredient id
  pantry: Map<string, number>; // P1; empty in P0
  recentRecipeIds: string[]; // last 4 weeks; empty in P0 (no plan history yet)
  frequentIngredientIds: string[]; // ids the household buys often — the `brand` signal
}

// ── Output ──────────────────────────────────────────────────────────────────

export interface PlanDayPick {
  day: number; // 1..days
  recipeId: string;
  slug: string;
  titleUk: string;
  portionScale: 1; // fixed at 1.0 in T2.3 — T3.3 relaxes it to [0.6, 1.4]
  costUah: number;
  promoShareUah: number;
  macrosPerServing: Macros;
}

export interface PlanTotals {
  costUah: number;
  budgetUah: number;
  promoShareUah: number;
  promoSharePct: number;
  surplus: Record<string, number>; // ingredientId → leftover base-unit amount (future pantry)
  avgDinnerMacros: Macros;
  proteinFloorMet: boolean; // form: every day ≥ proteinMinPerDay
  kcalCorridorMet: boolean; // form: every day within kcalRange
}

export type SolverResult =
  | { feasible: true; seed: number; goal: Goal; days: PlanDayPick[]; totals: PlanTotals }
  | {
      feasible: false;
      seed: number;
      goal: Goal;
      reason: string;
      shortfallUah?: number;
      shortfallProteinG?: number;
    };
