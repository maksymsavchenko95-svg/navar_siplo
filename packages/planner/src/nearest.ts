import { recipeCost, type RecipeCost } from "./cost.js";
import type {
  InfeasibleBinding,
  PlanDayPick,
  RecipeCandidate,
  SolverInput,
  SolverResult,
} from "./contract.js";
import { hardFilter, type HardFilterResult } from "./filter.js";
import { greedyPlan, planTotals } from "./greedy.js";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The cheapest plan that honours every hard constraint, **budget relaxed** (T2.5,
 * `FR-PLAN-006`). Same day-by-day shape as `greedyPlan` but ordered by ascending recipe
 * cost instead of descending score, and with no budget gate — the running pantry still
 * carries surplus forward. Deterministic: `(costUah, slug)` is a total order, so the
 * result does not depend on `seed` or candidate input order.
 */
export function cheapestPlan(kept: RecipeCandidate[], input: SolverInput): SolverResult {
  const base = { seed: input.seed, goal: input.goal };

  if (kept.length < input.days) {
    return {
      ...base,
      feasible: false,
      binding: "candidates",
      reason: `замало рецептів відповідає обмеженням (${kept.length} < ${input.days})`,
    };
  }

  const pantry = new Map(input.pantry);
  const picked = new Set<string>();
  const picks: PlanDayPick[] = [];
  const pickCosts: RecipeCost[] = [];

  for (let day = 1; day <= input.days; day++) {
    const withPantry: SolverInput = { ...input, pantry };
    const chosen = kept
      .filter((c) => !picked.has(c.recipeId))
      .map((c) => ({ c, cost: recipeCost(c, withPantry) }))
      .sort((a, b) => a.cost.costUah - b.cost.costUah || a.c.slug.localeCompare(b.c.slug))[0]!;

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
    pickCosts.push(chosen.cost);
    picked.add(chosen.c.recipeId);
    for (const [id, remaining] of chosen.cost.pantryAfter) pantry.set(id, remaining);
  }

  return {
    ...base,
    feasible: true,
    days: picks,
    totals: planTotals(picks, pickCosts, pantry, input),
  };
}

// ─── binding-constraint diagnosis ────────────────────────────────────────────

function withHardConstraints(
  input: SolverInput,
  over: Partial<SolverInput["hardConstraints"]>,
): SolverInput {
  return { ...input, hardConstraints: { ...input.hardConstraints, ...over } };
}

/** Does a plan fit the original budget once `over` relaxes one hard constraint? */
function fitsWithout(
  input: SolverInput,
  over: Partial<SolverInput["hardConstraints"]>,
  filterOpts?: { kcalSlack?: number },
): boolean {
  const relaxed = withHardConstraints(input, over);
  return greedyPlan(hardFilter(relaxed, filterOpts).kept, relaxed).feasible;
}

function reasonFor(
  binding: InfeasibleBinding,
  n: { shortfallUah?: number; proteinTargetWeek?: number; keptCount?: number; days: number },
): string {
  const uah = n.shortfallUah ?? 0;
  switch (binding) {
    case "protein":
      return `на ${uah} ₴ більше — інакше не набрати ${n.proteinTargetWeek} г білка за тиждень`;
    case "portion":
      return `на ${uah} ₴ більше — інакше калорійність не вкладається в коридор навіть з урахуванням розміру порції`;
    case "kcal":
      return `на ${uah} ₴ більше — інакше калорійність страв виходить за коридор`;
    case "excluded_ingredients":
      return `на ${uah} ₴ більше — інакше довелося б узяти виключені продукти`;
    case "candidates":
      return `замало рецептів відповідає обмеженням (${n.keptCount} < ${n.days})`;
    case "budget":
    default:
      return `на ${uah} ₴ більше — інакше не скласти ${n.days} вечер у межах бюджету`;
  }
}

/**
 * Turn an infeasible input into `{ nearest valid plan, ₴ delta, concrete reason }`
 * (`FR-PLAN-006`, TDD §4 step 7). Budget is the flex variable; every other hard constraint
 * stays. `binding` is found by relaxing one constraint at a time and re-solving at the
 * original budget — the first that makes a plan fit is named. Deterministic.
 */
export function diagnoseInfeasible(input: SolverInput, hf: HardFilterResult): SolverResult {
  const base = { seed: input.seed, goal: input.goal };
  const days = input.days;
  const hc = input.hardConstraints;

  if (hf.kept.length < days) {
    return {
      ...base,
      feasible: false,
      binding: "candidates",
      reason: reasonFor("candidates", { keptCount: hf.kept.length, days }),
    };
  }

  const cheapest = cheapestPlan(hf.kept, input);
  if (!cheapest.feasible) {
    return {
      ...base,
      feasible: false,
      binding: "candidates",
      reason: reasonFor("candidates", { keptCount: hf.kept.length, days }),
    };
  }

  const nearest = { days: cheapest.days, totals: cheapest.totals };
  const shortfallUah = Math.max(0, round2(cheapest.totals.costUah - input.budget));

  // (a) a strict dislike removes the cheap options?
  if (hc.excludedIngredients.length > 0 && fitsWithout(input, { excludedIngredients: [] })) {
    return {
      ...base,
      feasible: false,
      binding: "excluded_ingredients",
      reason: reasonFor("excluded_ingredients", { shortfallUah, days }),
      nearest,
      shortfallUah,
    };
  }

  // (b) form: the protein floor?
  if (hc.proteinMinPerDay != null) {
    const relaxed = withHardConstraints(input, { proteinMinPerDay: undefined });
    const probe = greedyPlan(hardFilter(relaxed).kept, relaxed);
    if (probe.feasible) {
      const weeklyProtein = round2(probe.days.reduce((s, d) => s + d.macrosPerServing.protein, 0));
      const proteinTargetWeek = Math.round(hc.proteinMinPerDay * days);
      const shortfallProteinG = Math.max(0, round2(proteinTargetWeek - weeklyProtein));
      return {
        ...base,
        feasible: false,
        binding: "protein",
        reason: reasonFor("protein", { shortfallUah, proteinTargetWeek, days }),
        nearest,
        shortfallUah,
        shortfallProteinG,
      };
    }
  }

  // (c) form: would portion-scaling alone (T3.3, no filter slack on top) have rescued the
  // corridor? Narrower and more specific than (d) — tried first so it can't be masked by
  // the wider relaxation. `kcalSlack: 0` avoids double-widening: `hardFilter` would otherwise
  // widen whatever `kcalRange` we substitute here by another `KCAL_FILTER_SLACK` on top.
  if (hc.kcalRange != null) {
    const maxPortionRange: [number, number] = [hc.kcalRange[0] / 1.4, hc.kcalRange[1] / 0.6];
    if (fitsWithout(input, { kcalRange: maxPortionRange }, { kcalSlack: 0 })) {
      return {
        ...base,
        feasible: false,
        binding: "portion",
        reason: reasonFor("portion", { shortfallUah, days }),
        nearest,
        shortfallUah,
      };
    }
  }

  // (d) form: the kcal corridor at all — even generous portion-scaling can't reconcile it.
  if (hc.kcalRange != null && fitsWithout(input, { kcalRange: undefined })) {
    return {
      ...base,
      feasible: false,
      binding: "kcal",
      reason: reasonFor("kcal", { shortfallUah, days }),
      nearest,
      shortfallUah,
    };
  }

  // (e) the corpus just costs more.
  return {
    ...base,
    feasible: false,
    binding: "budget",
    reason: reasonFor("budget", { shortfallUah, days }),
    nearest,
    shortfallUah,
  };
}
