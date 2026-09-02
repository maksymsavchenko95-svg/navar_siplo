import type { Macros } from "@navar/domain";

import {
  WEIGHTS,
  type RecipeCandidate,
  type RecipeIngredientLine,
  type SolverInput,
} from "./contract.js";

/** Test-only builders for `SolverInput` / `RecipeCandidate`. Not a `.test.ts` — not run. */

export const macros = (over: Partial<Macros> = {}): Macros => ({
  kcal: 700,
  protein: 45,
  fat: 20,
  carbs: 60,
  fiber: 6,
  ...over,
});

export const line = (
  over: Partial<RecipeIngredientLine> & Pick<RecipeIngredientLine, "id">,
): RecipeIngredientLine => ({
  amount: 200,
  unit: "g",
  category: "vegetable",
  optional: false,
  ...over,
});

let n = 0;
export const candidate = (over: Partial<RecipeCandidate> = {}): RecipeCandidate => {
  const i = over.recipeId ?? `r${++n}`;
  return {
    recipeId: i,
    slug: over.slug ?? i,
    titleUk: over.titleUk ?? i,
    servings: 4,
    activeMinutes: 20,
    ingredients: [line({ id: `${i}-a` }), line({ id: `${i}-b` })],
    macrosPerServing: macros(),
    ...over,
  };
};

export const solverInput = (over: Partial<SolverInput> = {}): SolverInput => {
  const candidates = over.candidates ?? [candidate(), candidate(), candidate()];
  const prices = over.prices ?? priceMapFor(candidates, 40);
  return {
    seed: 1,
    days: 5,
    budget: 2500,
    servings: 3,
    goal: "routine",
    hardConstraints: { excludedAllergens: [], excludedIngredients: [], maxActiveMinutes: 60 },
    weights: WEIGHTS[over.goal ?? "routine"],
    candidates,
    prices,
    nutrition: new Map(),
    pantry: new Map(),
    recentRecipeIds: [],
    frequentIngredientIds: [],
    ...over,
  };
};

/** A price entry for every ingredient id used by `candidates`. */
export function priceMapFor(
  candidates: readonly RecipeCandidate[],
  uah: number,
  opts: { promo?: boolean; packSize?: number } = {},
): SolverInput["prices"] {
  const m: SolverInput["prices"] = new Map();
  for (const c of candidates) {
    for (const l of c.ingredients) {
      m.set(l.id, { uah, promo: opts.promo ?? false, packSize: opts.packSize ?? 500 });
    }
  }
  return m;
}
