import type { RecipeCost } from "./cost.js";
import type { RecipeCandidate, SolverInput } from "./contract.js";

/** Reference "grams protein per ₴" that normalises the `proteinPerUah` term to ~[0,1]. */
const PROT_PER_UAH_REF = 1.0;
const VEG_CATEGORIES = new Set(["vegetable", "fruit", "legume"]);

export interface SolverState {
  budgetLeft: number;
  daysLeft: number;
  pickedIngredientIds: Set<string>;
  pickedRecipeIds: Set<string>;
}

export interface ScoreBreakdown {
  promo: number;
  pantry: number;
  reuse: number;
  brand: number;
  recency: number;
  cost: number;
  proteinPerUah: number;
  veg: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * `SCORE(recipe, state)` (TDD §4 step 3) — the weighted sum of soft signals, each
 * normalised to roughly [0, 1]. `routine` weights zero out `proteinPerUah` + `veg`, so the
 * exact same code path runs for both modes — this function reads only `input.weights`, never
 * the mode itself (ADR-09). The `cost` term is a live pressure ratio (may exceed 1); its
 * weight is negative.
 */
export function scoreRecipe(
  candidate: RecipeCandidate,
  cost: RecipeCost,
  state: SolverState,
  input: SolverInput,
  portionScale = 1,
): { score: number; breakdown: ScoreBreakdown } {
  const w = input.weights;
  const lines = candidate.ingredients;
  const n = lines.length || 1;

  const promo = cost.costUah > 0 ? clamp01(cost.promoShareUah / cost.costUah) : 0;

  // pantryUse — fraction of ingredients we already have. Pantry is empty in P0.
  const pantry = clamp01(lines.filter((l) => (input.pantry.get(l.id) ?? 0) > 0).length / n);

  const reuse = clamp01(lines.filter((l) => state.pickedIngredientIds.has(l.id)).length / n);

  const frequent = new Set(input.frequentIngredientIds);
  const brand = clamp01(lines.filter((l) => frequent.has(l.id)).length / n);

  const recency = input.recentRecipeIds.includes(candidate.recipeId) ? 1 : 0;

  const budgetPerDay = state.daysLeft > 0 ? state.budgetLeft / state.daysLeft : state.budgetLeft;
  const costPressure = budgetPerDay > 0 ? cost.costUah / budgetPerDay : 0;

  const proteinPerUah =
    cost.costUah > 0
      ? clamp01(
          (candidate.macrosPerServing.protein * portionScale) / cost.costUah / PROT_PER_UAH_REF,
        )
      : 0;

  const veg = clamp01(lines.filter((l) => VEG_CATEGORIES.has(l.category)).length / n);

  const breakdown: ScoreBreakdown = {
    promo,
    pantry,
    reuse,
    brand,
    recency,
    cost: costPressure,
    proteinPerUah,
    veg,
  };

  const score =
    w.promo * promo +
    w.pantry * pantry +
    w.reuse * reuse +
    w.brand * brand +
    w.recency * recency +
    w.cost * costPressure +
    w.proteinPerUah * proteinPerUah +
    w.veg * veg;

  return { score: Math.round(score * 1e6) / 1e6, breakdown };
}
