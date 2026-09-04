import type { Macros } from "@navar/domain";

import { recipeCost, type RecipeCost } from "./cost.js";
import { planTotals } from "./greedy.js";
import type {
  PlanDayPick,
  PlanTotals,
  RecipeCandidate,
  SolverGoalConstraints,
  SolverInput,
  SolverResult,
} from "./contract.js";
import { mulberry32 } from "./rng.js";
import { scoreRecipe, type SolverState } from "./score.js";

/**
 * TDD §4 steps 5–6 (T3.3, `FR-GOAL-007`) — after `greedyPlan` fixes *which* recipe fills
 * each day, this refines *how big a portion* of it (`form` only) and, via a seeded local
 * search, whether swapping one day's dish (or its portion) raises the plan's total score.
 * Gated on `hardConstraints.kcalRange` / `proteinMinPerDay` presence — never on `input.goal`
 * (ADR-09; `determinism.test.ts` greps for `goal ===` and fails the build on a match).
 *
 * Never downgrades a feasible plan to infeasible: `kcalCorridorMet` stays what it has been
 * since T2.3/F4 — an honest report, not a rejection gate. The corresponding "did portion
 * scaling actually help enough" question is answered on the *infeasible* input path instead
 * (`nearest.ts`'s new `"portion"` binding), which only changes a diagnosis message, never
 * turns an already-issuable plan into a rejected one.
 */

const MIN_SCALE = 0.6;
const MAX_SCALE = 1.4;
const LOCAL_SEARCH_ITERATIONS = 200;
/** A distinct offset from `greedyPlan`'s own `mulberry32(input.seed)` shuffle stream, so
 *  local search's draws never correlate with (or replay) greedy's day-order shuffle. */
const LOCAL_SEARCH_SEED_OFFSET = 1_000_003;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Scale a recipe's aggregate per-serving macros by a uniform portion factor. Exact, not an
 *  approximation: `recipeMacros` sums `per100g × grams/100` per ingredient, and scaling
 *  every ingredient's grams by the same factor scales that whole sum by the same factor. */
export function scalePortionMacros(m: Macros, scale: number): Macros {
  return {
    kcal: m.kcal * scale,
    protein: m.protein * scale,
    fat: m.fat * scale,
    carbs: m.carbs * scale,
    fiber: (m.fiber ?? 0) * scale,
  };
}

/**
 * The widest `[lo, hi]` portion scale that keeps `macros` inside both the kcal corridor and
 * the protein floor (kcal/protein scale linearly in `portionScale`, so this is closed-form —
 * no search needed). `null` when no scale in `[0.6, 1.4]` satisfies both at once.
 */
export function safePortionRange(
  macros: Macros,
  hc: Pick<SolverGoalConstraints, "kcalRange" | "proteinMinPerDay">,
): [number, number] | null {
  let lo = MIN_SCALE;
  let hi = MAX_SCALE;
  if (hc.kcalRange != null && macros.kcal > 0) {
    lo = Math.max(lo, hc.kcalRange[0] / macros.kcal);
    hi = Math.min(hi, hc.kcalRange[1] / macros.kcal);
  }
  if (hc.proteinMinPerDay != null && macros.protein > 0) {
    lo = Math.max(lo, hc.proteinMinPerDay / macros.protein);
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The single best portion scale for one dish: the value in `safePortionRange` closest to
 * `1.0` (minimal cost/macro deviation from the recipe's natural size). `1` (no scaling) when
 * no safe range exists — best-effort; leaves that day's true-corridor compliance as it was.
 */
export function bestPortionScale(
  macros: Macros,
  hc: Pick<SolverGoalConstraints, "kcalRange" | "proteinMinPerDay">,
): number {
  const range = safePortionRange(macros, hc);
  if (!range) return 1;
  const [lo, hi] = range;
  return Math.min(hi, Math.max(lo, 1));
}

export interface ReplayResult {
  picks: PlanDayPick[];
  pickCosts: RecipeCost[];
  totalScore: number;
  totalCost: number;
  finalPantry: Map<string, number>;
}

/**
 * Replay `recipeCost` + `scoreRecipe` day-by-day, in order, for an arbitrary fixed
 * (recipe, portionScale) sequence — threading the same running `pantry` / `budgetLeft` /
 * `daysLeft` / `pickedIngredientIds` / `pickedRecipeIds` state `greedyPlan` uses internally.
 * This is what makes "is this candidate plan's total score higher" and "does this scale
 * choice still fit the pantry-adjusted running budget" well-defined for any day-assignment,
 * not just a greedy-order prefix. `null` if a `recipeId` isn't in `candidatesById`.
 */
export function replay(
  assignment: readonly { recipeId: string; portionScale: number }[],
  candidatesById: ReadonlyMap<string, RecipeCandidate>,
  input: SolverInput,
): ReplayResult | null {
  let pantry = new Map(input.pantry);
  const state: SolverState = {
    budgetLeft: input.budget,
    daysLeft: input.days,
    pickedIngredientIds: new Set(),
    pickedRecipeIds: new Set(),
  };
  const picks: PlanDayPick[] = [];
  const pickCosts: RecipeCost[] = [];
  let totalScore = 0;

  for (let i = 0; i < assignment.length; i++) {
    const { recipeId, portionScale } = assignment[i]!;
    const c = candidatesById.get(recipeId);
    if (!c) return null;

    const withPantry: SolverInput = { ...input, pantry };
    const cost = recipeCost(c, withPantry, portionScale);
    const { score } = scoreRecipe(c, cost, state, withPantry, portionScale);
    totalScore += score;

    picks.push({
      day: i + 1,
      recipeId: c.recipeId,
      slug: c.slug,
      titleUk: c.titleUk,
      portionScale,
      costUah: cost.costUah,
      promoShareUah: cost.promoShareUah,
      macrosPerServing: scalePortionMacros(c.macrosPerServing, portionScale),
    });
    pickCosts.push(cost);

    state.budgetLeft = round2(state.budgetLeft - cost.costUah);
    state.daysLeft -= 1;
    state.pickedRecipeIds.add(c.recipeId);
    for (const l of c.ingredients) state.pickedIngredientIds.add(l.id);
    pantry = new Map(pantry);
    for (const [id, remaining] of cost.pantryAfter) pantry.set(id, remaining);
  }

  return {
    picks,
    pickCosts,
    totalScore: round2(totalScore),
    totalCost: round2(picks.reduce((s, p) => s + p.costUah, 0)),
    finalPantry: pantry,
  };
}

/**
 * TDD §4 step 5 (`form` only). Picks each day's best portion scale independently (closed
 * form), then — if the resulting total cost would exceed budget — repeatedly pins the day
 * whose scale increased cost the most back to `1` and re-replays, until the whole plan fits.
 * This always terminates: pinning every day reproduces the original all-`1` assignment,
 * which `greedyPlan` already validated as budget-feasible.
 */
export function portionFit(
  days: readonly PlanDayPick[],
  candidatesById: ReadonlyMap<string, RecipeCandidate>,
  input: SolverInput,
): { recipeId: string; portionScale: number }[] {
  const original = days.map((p) => ({ recipeId: p.recipeId, portionScale: 1 }));
  const fitted = days.map((p) => {
    const c = candidatesById.get(p.recipeId);
    const scale = c ? bestPortionScale(c.macrosPerServing, input.hardConstraints) : 1;
    return { recipeId: p.recipeId, portionScale: scale };
  });

  const pinned = new Set<number>();
  let assignment = fitted;
  let attempt = replay(assignment, candidatesById, input);

  while (attempt && attempt.totalCost > input.budget) {
    const deltas = attempt.picks
      .map((pick, i) => ({ i, delta: pick.costUah - days[i]!.costUah }))
      .filter((d) => !pinned.has(d.i) && d.delta > 0)
      .sort((a, b) => b.delta - a.delta);
    if (deltas.length === 0) break; // shouldn't happen — `original` alone is known-feasible
    pinned.add(deltas[0]!.i);
    assignment = fitted.map((a, i) => (pinned.has(i) ? original[i]! : a));
    attempt = replay(assignment, candidatesById, input);
  }

  return assignment;
}

/**
 * TDD §4 step 6 — up to `LOCAL_SEARCH_ITERATIONS` seeded moves over the day assignment.
 * Two move types: swap one day to an unused candidate from `kept` (both goals), or —
 * `isForm` only — resample one day's portion scale within its own safe range (so it can
 * never introduce a new protein-floor violation). A move is accepted iff the resulting
 * total cost stays within budget, every day's *scaled* protein still meets the floor
 * (`isForm`), and the total score strictly rises. The true kcal corridor is intentionally
 * **not** gated here (`scoreRecipe` carries no kcal term — corridor-fitting is step 5's job;
 * gating on it here would make local search a frequent no-op).
 */
export function localSearch(
  seed: number,
  initial: ReplayResult,
  kept: readonly RecipeCandidate[],
  candidatesById: ReadonlyMap<string, RecipeCandidate>,
  input: SolverInput,
  isForm: boolean,
): ReplayResult {
  const rng = mulberry32(seed + LOCAL_SEARCH_SEED_OFFSET);
  let current = initial;
  let currentAssignment = initial.picks.map((p) => ({
    recipeId: p.recipeId,
    portionScale: p.portionScale,
  }));

  const satisfiesProteinFloor = (r: ReplayResult): boolean => {
    const floor = input.hardConstraints.proteinMinPerDay;
    return floor == null || r.picks.every((p) => p.macrosPerServing.protein >= floor);
  };

  for (let iter = 0; iter < LOCAL_SEARCH_ITERATIONS; iter++) {
    const dayIdx = Math.floor(rng() * currentAssignment.length);
    const usePortionMove = isForm && rng() < 0.5;
    let candidate: { recipeId: string; portionScale: number }[];

    if (usePortionMove) {
      const c = candidatesById.get(currentAssignment[dayIdx]!.recipeId);
      const range = c ? safePortionRange(c.macrosPerServing, input.hardConstraints) : null;
      if (!range) continue;
      const [lo, hi] = range;
      const scale = lo + rng() * (hi - lo);
      candidate = currentAssignment.map((a, i) =>
        i === dayIdx ? { ...a, portionScale: scale } : a,
      );
    } else {
      const usedElsewhere = new Set(
        currentAssignment.filter((_, i) => i !== dayIdx).map((a) => a.recipeId),
      );
      const pool = kept.filter((c) => !usedElsewhere.has(c.recipeId));
      if (pool.length === 0) continue;
      const pick = pool[Math.floor(rng() * pool.length)]!;
      // A swapped-in dish gets its own best-fit scale immediately (isForm), not a bare `1` —
      // otherwise a swap could silently regress a day portionFit had already brought into
      // the true corridor back out of it (the accept gate below doesn't check kcal).
      const scale = isForm ? bestPortionScale(pick.macrosPerServing, input.hardConstraints) : 1;
      candidate = currentAssignment.map((a, i) =>
        i === dayIdx ? { recipeId: pick.recipeId, portionScale: scale } : a,
      );
    }

    const next = replay(candidate, candidatesById, input);
    if (!next) continue;
    if (next.totalCost > input.budget) continue;
    if (isForm && !satisfiesProteinFloor(next)) continue;
    if (next.totalScore <= current.totalScore) continue;

    current = next;
    currentAssignment = candidate;
  }

  return current;
}

/**
 * Orchestrates steps 5–6 over a feasible `greedyPlan` result and rebuilds `PlanTotals`.
 * `kept` is the hard-filtered candidate pool (never the raw, unfiltered `input.candidates`)
 * so a local-search swap can never reintroduce a candidate a hard constraint already ruled
 * out.
 */
export function refinePlan(
  result: Extract<SolverResult, { feasible: true }>,
  kept: readonly RecipeCandidate[],
  input: SolverInput,
): SolverResult {
  const candidatesById = new Map(kept.map((c) => [c.recipeId, c]));
  const { kcalRange, proteinMinPerDay } = input.hardConstraints;
  const isForm = kcalRange != null || proteinMinPerDay != null;

  const assignment = isForm
    ? portionFit(result.days, candidatesById, input)
    : result.days.map((p) => ({ recipeId: p.recipeId, portionScale: p.portionScale }));

  const afterPortionFit = replay(assignment, candidatesById, input) ?? {
    picks: result.days,
    pickCosts: [],
    totalScore: 0,
    totalCost: result.totals.costUah,
    finalPantry: new Map(input.pantry),
  };

  const searched = localSearch(input.seed, afterPortionFit, kept, candidatesById, input, isForm);

  const totals: PlanTotals = planTotals(
    searched.picks,
    searched.pickCosts,
    searched.finalPantry,
    input,
  );
  return { ...result, days: searched.picks, totals };
}
