import { db, savePlan, setPlanExplanation, toPlanRows } from "@navar/db";
import {
  type ConsumptionModel,
  type ExplainPlanInput,
  type Goal,
  hasShelfMarkdown,
  type InfeasibleBinding,
  type PersonalPromo,
  type Promotion,
  type Macros,
  type MapperResult,
  type NearestPlan,
  type PlanGenerateResult,
} from "@navar/domain";
import { explainPlanStep, runStep } from "@navar/llm";
import { mapPlan, type MapperRetail, type PlanIngredientLine, toBaseAmount } from "@navar/mapper";
import {
  generatePlan,
  WEIGHTS,
  type RecipeCandidate,
  type SolverInput,
  type SolverResult,
} from "@navar/planner";
import { AuthRequiredError, NoCartError, type RetailProvider } from "@navar/retail";
import { ALLERGEN_LABEL_UK, hasHardExclusion } from "@navar/safety";

import { getLlm, getLlmTracer } from "./llm.js";
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

export interface PlanContext {
  input: SolverInput;
  /** The mapper output for the whole priced corpus, or `null` when pricing was unavailable. */
  mapperResult: MapperResult | null;
  /**
   * Promo context read *before* planning (`FR-PLAN-004`). `campaigns` are shelf campaign
   * groups — Stage 2 (T4.1) will pull their SKUs; today they prove the read happened and
   * feed the trace. `personal` are bonus-multiplier offers still inside their window —
   * never priced into the plan (M0 audit). Both are `[]` when the read failed.
   */
  promoContext: { campaigns: Promotion[]; personal: PersonalPromo[] };
  /** canonical_ingredients slug → id. */
  idBySlug: Map<string, string>;
  /** recipe slug → the slugs of its (non-optional + optional) ingredient lines. */
  recipeSlugIngredients: Map<string, string[]>;
  /** An `AuthRequiredError` / `NoCartError` from the pricing step, surfaced not thrown. */
  retailError: AuthRequiredError | NoCartError | null;
  /** Recipes the household's allergen restrictions removed before the solver saw them (T2.5). */
  excludedRecipeCount: number;
  /** Guest-facing labels for those restrictions — feeds the infeasible reason (T2.5). */
  excludedAllergenLabels: string[];
}

/**
 * Household + corpus + mapper + safety → everything `generatePlan` and the persistence
 * layer need (T2.3 / T2.4). `buildSolverInput` is the thin `.input` view for callers that
 * only run the solver (`plan-probe`, the existing test).
 */
export async function buildPlanContext(
  householdId: string,
  retail: RetailProvider,
  opts: BuildPlanOpts = {},
): Promise<PlanContext> {
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
  const excludedRecipeCount = recipes.length - usableRecipes.length;
  const excludedAllergenLabels = exclusions.allergens.map(
    (a) => ALLERGEN_LABEL_UK[a as keyof typeof ALLERGEN_LABEL_UK] ?? a,
  );

  const recipeSlugIngredients = new Map<string, string[]>(
    usableRecipes.map((r) => [r.slug, r.ingredients.map((ri) => ri.ingredient.slug)]),
  );

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
  const prices: SolverInput["prices"] = new Map();
  let mapperResult: MapperResult | null = null;
  let retailError: AuthRequiredError | NoCartError | null = null;

  // ── promotions (T4.1, FR-PLAN-004) ───────────────────────────────────────
  // The plan is built *after* reading promotions, not decorated with them afterwards.
  // Kicked off before the mapper and awaited alongside it, so the two reads overlap and
  // this costs no extra wall-clock. Fail-soft by design: a promo outage degrades the plan
  // to "no promo context" (NFR-REL-005), it never fails generation.
  const promoReads = Promise.allSettled([
    // Wrapped so a provider that throws *synchronously* still lands in `allSettled`
    // rather than escaping and failing plan generation.
    (async () => retail.getPromotions())(),
    (async () => retail.getMyPromos())(),
  ]);

  try {
    mapperResult = await mapPlan(
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
    for (const m of mapperResult.matches) {
      const id = idBySlug.get(m.slug);
      if (!id || !m.match) continue;
      prices.set(id, {
        uah: m.match.price,
        // Markdown only — the multi-buy tier is separate (see `skuMatchesToPrices`).
        promo: hasShelfMarkdown(m.match),
        packSize: m.packSize ?? m.neededAmount,
        tier: m.promoTier,
      });
    }
  } catch (err) {
    // No auth / no cart / a transient MCP error → no prices. The plan degrades to an
    // infeasible verdict rather than failing generation; auth / cart errors are surfaced
    // (not thrown) so `plan.generate` can return a reconnect prompt.
    if (err instanceof AuthRequiredError || err instanceof NoCartError) retailError = err;
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

  const [promotionsRes, myPromosRes] = await promoReads;
  if (promotionsRes.status === "rejected" || myPromosRes.status === "rejected") {
    console.warn("[plan] promo context unavailable — planning without it");
  }
  const promoContext = {
    campaigns: promotionsRes.status === "fulfilled" ? promotionsRes.value : [],
    personal: myPromosRes.status === "fulfilled" ? activePromos(myPromosRes.value) : [],
  };

  const input: SolverInput = {
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

  return {
    input,
    mapperResult,
    promoContext,
    idBySlug,
    recipeSlugIngredients,
    retailError,
    excludedRecipeCount,
    excludedAllergenLabels,
  };
}

/**
 * Personal offers still inside their window on `asOf` (ISO `YYYY-MM-DD`, default today).
 * A weekly plan can outlast an offer, so an expired one must not be presented as available
 * (M0 audit). A missing `endDate` is treated as open-ended rather than dropped.
 */
export function activePromos(
  promos: readonly PersonalPromo[],
  asOf: string = new Date().toISOString().slice(0, 10),
): PersonalPromo[] {
  return promos.filter((p) => !p.endDate || p.endDate >= asOf);
}

/** Household + corpus + mapper + safety → a `SolverInput` (T2.3). */
export async function buildSolverInput(
  householdId: string,
  retail: RetailProvider,
  opts: BuildPlanOpts = {},
): Promise<SolverInput> {
  return (await buildPlanContext(householdId, retail, opts)).input;
}

/**
 * `ExplainPlanInput` from a feasible plan (T2.6, pure). `savingsUah` = the pre-promo delta
 * on the shopping list (Σ `(oldPrice − price) × packCount` over promo lines).
 */
export function toExplainInput(args: {
  goal: Goal;
  days: number;
  budgetUah: number;
  totalUah: number;
  dishes: string[];
  promoSharePct: number;
  lines: readonly {
    isPromo?: boolean;
    price?: string | null;
    oldPrice?: string | null;
    packCount?: number;
  }[];
}): ExplainPlanInput {
  const savingsUah = args.lines.reduce((s, l) => {
    if (!l.isPromo || l.price == null || l.oldPrice == null) return s;
    return s + Math.max(0, (Number(l.oldPrice) - Number(l.price)) * (l.packCount ?? 0));
  }, 0);
  return {
    days: args.days,
    budgetUah: args.budgetUah,
    totalUah: args.totalUah,
    savingsUah: Math.round(savingsUah * 100) / 100,
    promoSharePct: Math.min(100, Math.max(0, args.promoSharePct)),
    goal: args.goal,
    dishes: args.dishes.slice(0, 40),
  };
}

/** The solver's `nearest` plan → the trimmed view the client gets (no SKU list in P0). */
export function toNearestView(nearest: {
  days: readonly {
    day: number;
    slug: string;
    titleUk: string;
    costUah: number;
    promoShareUah: number;
    macrosPerServing: Macros;
  }[];
  totals: {
    costUah: number;
    promoSharePct: number;
    proteinFloorMet: boolean;
    kcalCorridorMet: boolean;
  };
}): NearestPlan {
  return {
    days: nearest.days.map((d) => ({
      day: d.day,
      slug: d.slug,
      titleUk: d.titleUk,
      costUah: d.costUah,
      promoShareUah: d.promoShareUah,
      macrosPerServing: {
        kcal: d.macrosPerServing.kcal,
        protein: d.macrosPerServing.protein,
        fat: d.macrosPerServing.fat,
        carbs: d.macrosPerServing.carbs,
      },
    })),
    costUah: nearest.totals.costUah,
    promoSharePct: Math.min(100, Math.max(0, nearest.totals.promoSharePct)),
    proteinFloorMet: nearest.totals.proteinFloorMet,
    kcalCorridorMet: nearest.totals.kcalCorridorMet,
  };
}

/**
 * The Guest-facing infeasible reason (T2.5, `FR-PLAN-006`, pure). The planner's `reason` is
 * already concrete; for a pure `budget` bind we prepend the restriction context the planner
 * can't see (allergen labels), so the Guest learns *why* the cheapest valid plan is that
 * expensive. `protein` / `kcal` / `excluded_ingredients` / `candidates` pass through.
 */
export function toInfeasibleReason(args: {
  binding: InfeasibleBinding;
  plannerReason: string;
  shortfallUah?: number;
  restrictionLabels: readonly string[];
}): string {
  if (args.binding === "budget" && args.restrictionLabels.length > 0 && args.shortfallUah != null) {
    return `на ${args.shortfallUah} ₴ більше — найдешевший план з урахуванням ваших обмежень (${args.restrictionLabels.join(", ")})`;
  }
  return args.plannerReason;
}

/**
 * Generate a plan for `householdId`, persist it if feasible, attach the `explainPlan`
 * note, and return `{ status, planId }` (roadmap T2.4 + T2.6). An infeasible input returns
 * the cheapest valid plan + the ₴ delta + a concrete reason inline (T2.5), persisting
 * nothing.
 */
export async function generateAndPersistPlan(
  householdId: string,
  retail: RetailProvider,
  opts: BuildPlanOpts = {},
): Promise<PlanGenerateResult> {
  let ctx: PlanContext;
  try {
    ctx = await buildPlanContext(householdId, retail, opts);
  } catch (err) {
    if (err instanceof PlanInputError) return { status: "error", message: err.message };
    throw err;
  }

  if (ctx.retailError instanceof AuthRequiredError) {
    return { status: "auth_required", hint: ctx.retailError.hint };
  }
  if (ctx.retailError instanceof NoCartError) {
    return { status: "no_cart", hint: ctx.retailError.message };
  }

  const result: SolverResult = generatePlan(ctx.input);
  if (!result.feasible) {
    return {
      status: "infeasible",
      binding: result.binding,
      reason: toInfeasibleReason({
        binding: result.binding,
        plannerReason: result.reason,
        shortfallUah: result.shortfallUah,
        restrictionLabels: ctx.excludedRecipeCount > 0 ? ctx.excludedAllergenLabels : [],
      }),
      ...(result.shortfallUah != null ? { shortfallUah: result.shortfallUah } : {}),
      ...(result.shortfallProteinG != null ? { shortfallProteinG: result.shortfallProteinG } : {}),
      ...(result.nearest ? { nearest: toNearestView(result.nearest) } : {}),
    };
  }

  const emptyMapper: MapperResult = {
    branchId: "",
    consolidated: [],
    matches: [],
    stats: { total: 0, matched: 0, needsConfirmation: 0, noMatch: 0, blocked: 0 },
  };

  const rows = toPlanRows({
    householdId,
    goal: result.goal,
    seed: result.seed,
    days: ctx.input.days,
    budgetUah: ctx.input.budget,
    servings: ctx.input.servings,
    picks: result.days,
    totals: {
      costUah: result.totals.costUah,
      promoSharePct: result.totals.promoSharePct,
      estimatedCostUah: result.totals.estimatedCostUah,
      unpricedLineCount: result.totals.unpricedLineCount,
      proteinFloorMet: result.totals.proteinFloorMet,
      kcalCorridorMet: result.totals.kcalCorridorMet,
    },
    mapper: ctx.mapperResult ?? emptyMapper,
    idBySlug: ctx.idBySlug,
    recipeSlugIngredients: ctx.recipeSlugIngredients,
  });

  const planId = await savePlan(rows);

  const explain = await runStep(
    explainPlanStep,
    toExplainInput({
      goal: result.goal,
      days: ctx.input.days,
      budgetUah: ctx.input.budget,
      totalUah: result.totals.costUah,
      dishes: result.days.map((d) => d.titleUk),
      promoSharePct: result.totals.promoSharePct,
      lines: rows.lines,
    }),
    { provider: getLlm(), tracer: getLlmTracer() },
  );
  await setPlanExplanation(planId, explain.value.text);

  return { status: "ok", planId };
}
