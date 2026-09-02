import type { Macros } from "@navar/domain";

import { recipeCost } from "./cost.js";
import type {
  PlanDayPick,
  PlanTotals,
  RecipeCandidate,
  SolverInput,
  SolverResult,
} from "./contract.js";
import { mulberry32, shuffle } from "./rng.js";
import { scoreRecipe, type SolverState } from "./score.js";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

const ZERO: Macros = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };

/** Sum the cheapest `k` distinct recipe costs from `pool`. */
function cheapestRemainder(pool: { costUah: number }[], k: number): number | null {
  if (pool.length < k) return null;
  return [...pool]
    .sort((a, b) => a.costUah - b.costUah)
    .slice(0, k)
    .reduce((s, r) => s + r.costUah, 0);
}

function computeTotals(
  picks: PlanDayPick[],
  finalPantry: Map<string, number>,
  input: SolverInput,
): PlanTotals {
  const costUah = round2(picks.reduce((s, p) => s + p.costUah, 0));
  const promoShareUah = round2(picks.reduce((s, p) => s + p.promoShareUah, 0));

  const macroSum = { ...ZERO };
  for (const p of picks) {
    macroSum.kcal += p.macrosPerServing.kcal;
    macroSum.protein += p.macrosPerServing.protein;
    macroSum.fat += p.macrosPerServing.fat;
    macroSum.carbs += p.macrosPerServing.carbs;
    macroSum.fiber = (macroSum.fiber ?? 0) + (p.macrosPerServing.fiber ?? 0);
  }
  const n = picks.length || 1;
  const avgDinnerMacros: Macros = {
    kcal: round2(macroSum.kcal / n),
    protein: round2(macroSum.protein / n),
    fat: round2(macroSum.fat / n),
    carbs: round2(macroSum.carbs / n),
    fiber: round2((macroSum.fiber ?? 0) / n),
  };

  const surplus: Record<string, number> = {};
  for (const [id, amt] of finalPantry) if (amt > 0) surplus[id] = round6(amt);

  const { proteinMinPerDay, kcalRange } = input.hardConstraints;
  const proteinFloorMet =
    proteinMinPerDay == null || picks.every((p) => p.macrosPerServing.protein >= proteinMinPerDay);
  const kcalCorridorMet =
    kcalRange == null ||
    picks.every(
      (p) => p.macrosPerServing.kcal >= kcalRange[0] && p.macrosPerServing.kcal <= kcalRange[1],
    );

  return {
    costUah,
    budgetUah: input.budget,
    promoShareUah,
    promoSharePct: costUah > 0 ? round2((promoShareUah / costUah) * 100) : 0,
    surplus,
    avgDinnerMacros,
    proteinFloorMet,
    kcalCorridorMet,
  };
}

/**
 * GREEDY day-by-day (TDD §4 step 4). Shuffle the candidate pool by `seed` (so score ties
 * break reproducibly and different seeds give different valid plans), then for each day
 * pick the highest-scoring recipe that (a) fits the remaining budget and (b) leaves a
 * cheapest-valid set for the other days that still fits. Surplus from earlier picks feeds
 * the running pantry, so later recipes don't re-buy a whole jar. No recipe repeats. On
 * failure the result is a terse infeasible verdict (T2.5 turns it into a nearest plan + delta).
 */
export function greedyPlan(kept: RecipeCandidate[], input: SolverInput): SolverResult {
  const base = { seed: input.seed, goal: input.goal };

  if (kept.length < input.days) {
    return {
      ...base,
      feasible: false,
      reason: `замало рецептів відповідає обмеженням (${kept.length} < ${input.days})`,
    };
  }

  const shuffled = shuffle(kept, mulberry32(input.seed));
  const pantry = new Map(input.pantry);
  const state: SolverState = {
    budgetLeft: input.budget,
    daysLeft: input.days,
    pickedIngredientIds: new Set(),
    pickedRecipeIds: new Set(),
  };
  const picks: PlanDayPick[] = [];

  for (let day = 1; day <= input.days; day++) {
    const withPantry: SolverInput = { ...input, pantry };
    const scored = shuffled
      .filter((c) => !state.pickedRecipeIds.has(c.recipeId))
      .map((c) => {
        const cost = recipeCost(c, withPantry);
        return { c, cost, score: scoreRecipe(c, cost, state, withPantry).score };
      })
      .sort((a, b) => b.score - a.score); // stable — seeded shuffle order breaks ties

    let chosen: (typeof scored)[number] | undefined;
    for (const entry of scored) {
      if (entry.cost.costUah > state.budgetLeft) continue;
      const rest = scored
        .filter((e) => e.c.recipeId !== entry.c.recipeId)
        .map((e) => ({ costUah: e.cost.costUah }));
      const remainder = cheapestRemainder(rest, state.daysLeft - 1);
      if (remainder == null) continue; // not enough distinct recipes left
      if (remainder <= round2(state.budgetLeft - entry.cost.costUah)) {
        chosen = entry;
        break;
      }
    }

    if (!chosen) {
      const cheapestAll =
        cheapestRemainder(
          scored.map((e) => ({ costUah: e.cost.costUah })),
          state.daysLeft,
        ) ?? Infinity;
      const shortfallUah =
        Number.isFinite(cheapestAll) && cheapestAll > state.budgetLeft
          ? round2(cheapestAll - state.budgetLeft)
          : undefined;
      return {
        ...base,
        feasible: false,
        reason: shortfallUah
          ? `план не вкладається в бюджет — бракує ${shortfallUah} ₴`
          : `не вдалося скласти ${input.days} страв у межах обмежень`,
        ...(shortfallUah ? { shortfallUah } : {}),
      };
    }

    picks.push({
      day,
      recipeId: chosen.c.recipeId,
      slug: chosen.c.slug,
      titleUk: chosen.c.titleUk,
      portionScale: 1,
      costUah: chosen.cost.costUah,
      promoShareUah: chosen.cost.promoShareUah,
      macrosPerServing: chosen.c.macrosPerServing,
    });
    state.budgetLeft = round2(state.budgetLeft - chosen.cost.costUah);
    state.daysLeft -= 1;
    state.pickedRecipeIds.add(chosen.c.recipeId);
    for (const l of chosen.c.ingredients) state.pickedIngredientIds.add(l.id);
    for (const [id, remaining] of chosen.cost.pantryAfter) pantry.set(id, remaining);
  }

  return {
    ...base,
    feasible: true,
    days: picks,
    totals: computeTotals(picks, pantry, input),
  };
}
