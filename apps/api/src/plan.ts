import { db, schema } from "@navar/db";
import type { ConsumptionModel, Goal, Macros } from "@navar/domain";
import { mapPlan, type MapperRetail, type PlanIngredientLine, toBaseAmount } from "@navar/mapper";
import { WEIGHTS, type RecipeCandidate, type SolverInput } from "@navar/planner";
import type { RetailProvider } from "@navar/retail";
import { hasHardExclusion } from "@navar/safety";

import {
  getRerankFn,
  loadExclusions,
  loadIdBySlug,
  loadIngredientMacros,
  loadMapperDict,
  makeIngredientSafety,
  makeSkuSafety,
} from "./mapper.js";

/**
 * The nutrition targets are *daily*; a P0 plan is 5 dinners. Scale the daily protein floor
 * and kcal centre to a single dinner. `0.22` fits the corpus (recipes average ~500 kcal /
 * ~27 g protein per serving) and a `gain`-direction daily target (~3000 kcal / ~140 g).
 * Revisit for full-day plans (P1). The kcal corridor is carried for reporting only in T2.3
 * — T3.3's portion fit is what enforces it.
 */
export const MEAL_SHARE = 0.22;

/** Daily protein floor / kcal corridor → per-dinner (`MEAL_SHARE`). Pure, testable. */
export function perDinnerTargets(t: {
  proteinMinG: number;
  kcalTarget: number;
  kcalTolerance: number;
}): { proteinMinPerDay: number; kcalRange: [number, number] } {
  const tol = t.kcalTolerance;
  return {
    proteinMinPerDay: Math.round(t.proteinMinG * MEAL_SHARE),
    kcalRange: [
      Math.round(t.kcalTarget * (1 - tol) * MEAL_SHARE),
      Math.round(t.kcalTarget * (1 + tol) * MEAL_SHARE),
    ],
  };
}

/** `form` goal with no `nutrition_targets` row — the check `household.setGoal` defers here. */
export class PlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanInputError";
  }
}

export interface BuildPlanOpts {
  days?: number;
  budgetUah?: number;
  seed?: number;
  goal?: Goal;
}

/** Household + corpus + mapper + safety → a `SolverInput` (T2.3). T2.4 wraps this in `plan.generate`. */
export async function buildSolverInput(
  householdId: string,
  retail: RetailProvider,
  opts: BuildPlanOpts = {},
): Promise<SolverInput> {
  const hh = await db.query.households.findFirst({
    where: (h, { eq: e }) => e(h.id, householdId),
    with: { members: true, preferences: true, consumptionModel: true },
  });
  if (!hh) throw new PlanInputError(`household ${householdId} not found`);
  const targets = await db.query.nutritionTargets.findFirst({
    where: (nt, { eq: e }) => e(nt.householdId, householdId),
  });

  const goal: Goal = opts.goal ?? (hh.goal as Goal);
  const days = opts.days ?? 5;
  const seed = opts.seed ?? 1;
  const budget = opts.budgetUah ?? (hh.weeklyBudget != null ? Number(hh.weeklyBudget) : 2500);
  const servings = Math.max(1, hh.members.filter((m) => m.kind !== "pet").length);
  const maxActiveMinutes = hh.preferences?.maxPrepMinutes ?? 60;

  const exclusions = await loadExclusions(householdId);

  // ── form goal constraints (per-dinner) ────────────────────────────────────
  const goalConstraints: { proteinMinPerDay?: number; kcalRange?: [number, number] } = {};
  if (goal === "form") {
    const t = targets;
    if (!t) {
      throw new PlanInputError(
        "form goal needs nutrition targets — run household.computeNutrition first",
      );
    }
    Object.assign(
      goalConstraints,
      perDinnerTargets({
        proteinMinG: t.proteinMinG,
        kcalTarget: t.kcalTarget,
        kcalTolerance: Number(t.kcalTolerance),
      }),
    );
  }

  // ── corpus → candidates ──────────────────────────────────────────────────
  const recipes = await db.query.recipes.findMany({
    with: { ingredients: { with: { ingredient: true } } },
  });
  const excludedAllergens = new Set<string>(exclusions.allergens);
  const usableRecipes = recipes.filter((r) => !r.allergens.some((a) => excludedAllergens.has(a)));

  const candidates: RecipeCandidate[] = usableRecipes.map((r) => ({
    recipeId: r.id,
    slug: r.slug,
    titleUk: r.titleUk,
    servings: r.servings,
    activeMinutes: r.activeMinutes,
    ingredients: r.ingredients.map((ri) => {
      const ing = ri.ingredient;
      const entry = {
        slug: ing.slug,
        nameUk: ing.nameUk,
        category: ing.category as RecipeCandidate["ingredients"][number]["category"],
        baseUnit: ing.baseUnit as "g" | "ml" | "pcs",
        densityGMl: ing.densityGMl == null ? null : Number(ing.densityGMl),
        gramsPerPiece: ing.gramsPerPiece == null ? null : Number(ing.gramsPerPiece),
        synonyms: [] as string[],
        allergens: [] as string[],
      };
      return {
        id: ing.id,
        amount: toBaseAmount(entry, Number(ri.amount), ri.unit as "g" | "ml" | "pcs" | "kg" | "l"),
        unit: entry.baseUnit,
        category: entry.category,
        optional: ri.optional,
      };
    }),
    macrosPerServing: {
      kcal: r.kcalServing == null ? 0 : Number(r.kcalServing),
      protein: r.proteinServing == null ? 0 : Number(r.proteinServing),
      fat: r.fatServing == null ? 0 : Number(r.fatServing),
      carbs: r.carbsServing == null ? 0 : Number(r.carbsServing),
      fiber: 0,
    } satisfies Macros,
  }));

  // ── prices via the mapper (T2.1/T2.2) ────────────────────────────────────
  const lines: PlanIngredientLine[] = usableRecipes.flatMap((r) =>
    r.ingredients.map((ri) => ({
      slug: ri.ingredient.slug,
      amount: Number(ri.amount),
      unit: ri.unit as PlanIngredientLine["unit"],
      optional: ri.optional,
    })),
  );
  const uniqueSlugs = [...new Set(lines.map((l) => l.slug))];
  const dict = await loadMapperDict(uniqueSlugs);
  const idBySlug = await loadIdBySlug(uniqueSlugs);
  const prices = new Map<string, { uah: number; promo: boolean; packSize: number }>();
  try {
    const mapped = await mapPlan(
      { lines, dict },
      {
        retail: retail as MapperRetail,
        rerank: getRerankFn(),
        ...(hasHardExclusion(exclusions)
          ? {
              ingredientSafety: makeIngredientSafety(exclusions),
              skuSafety: makeSkuSafety(retail, exclusions, householdId),
            }
          : {}),
      },
    );
    for (const m of mapped.matches) {
      const id = idBySlug.get(m.slug);
      if (!id || !m.match) continue;
      prices.set(id, {
        uah: m.match.price,
        promo: m.isPromo,
        packSize: m.packSize ?? m.neededAmount,
      });
    }
  } catch (err) {
    // No auth / no cart / a transient MCP error → no prices. The plan degrades to an
    // infeasible verdict (the caller sees the reason) rather than failing generation.
    console.warn(
      `[plan] pricing unavailable — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── nutrition + household signals ────────────────────────────────────────
  const allIds = [...new Set(candidates.flatMap((c) => c.ingredients.map((l) => l.id)))];
  const nutrition = await loadIngredientMacros(allIds);

  const model = (hh.consumptionModel?.model ?? null) as ConsumptionModel | null;
  const frequentIngredientIds = (model?.buyFrequency ?? [])
    .slice()
    .sort((a, b) => b.buysPer4Weeks - a.buysPer4Weeks)
    .slice(0, 10)
    .map((b) => idBySlug.get(b.key))
    .filter((id): id is string => id != null);

  const excludedIngredients = exclusions.ingredients
    .map((slug) => idBySlug.get(slug))
    .filter((id): id is string => id != null);

  return {
    seed,
    days,
    budget,
    servings,
    goal,
    hardConstraints: {
      excludedAllergens: exclusions.allergens,
      excludedIngredients,
      maxActiveMinutes,
      ...goalConstraints,
    },
    weights: WEIGHTS[goal],
    candidates,
    prices,
    nutrition,
    pantry: new Map(),
    recentRecipeIds: [],
    frequentIngredientIds,
  };
}
