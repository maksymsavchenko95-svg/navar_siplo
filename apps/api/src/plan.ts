import { db, type PlanRecipeRow, savePlan, setPlanExplanation, toPlanRows } from "@navar/db";
import {
  type ConsumptionModel,
  type ExplainPlanInput,
  type Goal,
  type InfeasibleBinding,
  type PersonalPromo,
  type Promotion,
  type Macros,
  type MapperResult,
  type NearestPlan,
  type PlanGenerateResult,
  type PlanGenStage,
  type PlanRecipeResult,
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
import {
  AuthRequiredError,
  type McpCallRecord,
  NoCartError,
  type RetailProvider,
  runWithMcpTrace,
} from "@navar/retail";
import { ALLERGEN_LABEL_UK, hasHardExclusion } from "@navar/safety";

import { getLlm, getLlmTracer } from "./llm.js";
import { persistMcpTrace } from "./mcp-trace.js";
import { savePlanContext, toCacheable } from "./plan-context-cache.js";
import { setGenStage } from "./plan-progress.js";
import {
  getRerankFn,
  loadExclusions,
  loadIdBySlug,
  loadIngredientMacros,
  loadMapperDict,
  makeIngredientSafety,
  makeSkuSafety,
  resizePlanList,
  skuMatchesToPrices,
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

/**
 * The seed only breaks score ties in the solver's shuffle / local search (ADR-03) — it has
 * no effect on budget, restrictions, or nutrition. Guests never pick one; when a caller
 * omits `seed`, each `generate` gets a fresh one from this range so identical inputs don't
 * always produce the identical plan. The R9 "Замовити знову" re-order and the CLI probes
 * still pass an explicit seed (the plan's own, or one on the command line) and are unaffected.
 */
const RANDOM_SEED_MAX = 5;
function randomSeed(): number {
  return Math.floor(Math.random() * RANDOM_SEED_MAX) + 1;
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
  /** Progress breadcrumb (T4.5) — fired at `"context"` (entry) and `"pricing"` (before the mapper). */
  onStage?: (stage: PlanGenStage) => void;
  /**
   * `generateAndPersistPlan` only. `true` (default for the tRPC path) returns as soon as the
   * plan is saved and writes the `explainPlan` note in the background — it's cosmetic and
   * `plan.get` tolerates its absence. `plan:probe` / integration tests pass `false` so they
   * still observe the note on return.
   */
  detachExplanation?: boolean;
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
  opts.onStage?.("context");
  // Independent reads — one round-trip each, no data dependency between them (T4.5).
  const [hh, targets, exclusions, allRecipes] = await Promise.all([
    db.query.households.findFirst({
      where: (h, { eq: e }) => e(h.id, householdId),
      with: { members: true, preferences: true, consumptionModel: true },
    }),
    db.query.nutritionTargets.findFirst({
      where: (nt, { eq: e }) => e(nt.householdId, householdId),
    }),
    loadExclusions(householdId),
    db.query.recipes.findMany({ with: { ingredients: { with: { ingredient: true } } } }),
  ]);
  if (!hh) throw new PlanInputError(`household ${householdId} not found`);

  const goal: Goal = opts.goal ?? (hh.goal as Goal);
  const days = opts.days ?? 5;
  const seed = opts.seed ?? randomSeed();
  const budget = opts.budgetUah ?? (hh.weeklyBudget != null ? Number(hh.weeklyBudget) : 2500);
  // form mode plans for exactly one person — no household-size picker, no family-size scaling.
  const servings =
    goal === "form" ? 1 : Math.max(1, hh.members.filter((m) => m.kind !== "pet").length);
  const maxActiveMinutes = hh.preferences?.maxPrepMinutes ?? 60;

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
  const excludedAllergens = new Set<string>(exclusions.allergens);
  const usableRecipes = allRecipes.filter(
    (r) => !r.allergens.some((a) => excludedAllergens.has(a)),
  );
  const excludedRecipeCount = allRecipes.length - usableRecipes.length;
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
  const allIngredientIds = [...new Set(candidates.flatMap((c) => c.ingredients.map((l) => l.id)))];
  // dict + id map (mapper inputs) and the macro table (post-mapper) — all independent of the
  // mapper itself, so overlap them with it (T4.5). `nutritionRead` is awaited after mapPlan.
  const [dict, idBySlug] = await Promise.all([
    loadMapperDict(uniqueSlugs),
    loadIdBySlug(uniqueSlugs),
  ]);
  const nutritionRead = loadIngredientMacros(allIngredientIds);
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

  opts.onStage?.("pricing");
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
    for (const [id, price] of skuMatchesToPrices(mapperResult.matches, idBySlug)) {
      prices.set(id, price);
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
  const nutrition = await nutritionRead;

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
    quantityKg?: string | null;
  }[];
}): ExplainPlanInput {
  const savingsUah = args.lines.reduce((s, l) => {
    if (!l.isPromo || l.price == null || l.oldPrice == null) return s;
    const qty = l.quantityKg != null ? Number(l.quantityKg) : (l.packCount ?? 0);
    return s + Math.max(0, (Number(l.oldPrice) - Number(l.price)) * qty);
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
 * `plan.recipe` (R2, pure). Scale a saved dinner's recipe to the household: ingredient
 * amounts by `servings / recipe.servings × portionScale`; `macrosPerServing` is taken
 * straight from the `plan_items` snapshot (already post-`portionScale` per `@navar/planner`'s
 * `scalePortionMacros`) and never recomputed. `null` row → `not_found`; a pruned recipe
 * (`row.recipe === null`) → `recipe_unavailable` carrying the stored title + day.
 */
export function toPlanRecipeView(row: PlanRecipeRow | null): PlanRecipeResult {
  if (!row) return { status: "not_found" };
  const { item, recipe } = row;
  if (!recipe) {
    return { status: "recipe_unavailable", titleUk: item.titleUk, dayIndex: item.dayIndex };
  }

  const scale = (item.servings / recipe.servings) * item.portionScale;
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const KNOWN_UNITS = new Set(["g", "ml", "pcs", "kg", "l"]);

  return {
    status: "ok",
    recipe: {
      dayIndex: item.dayIndex,
      titleUk: item.titleUk,
      totalMinutes: recipe.totalMinutes,
      activeMinutes: recipe.activeMinutes,
      difficulty: recipe.difficulty,
      servings: item.servings,
      portionScale: item.portionScale,
      steps: recipe.steps,
      ingredients: recipe.ingredients.map((ri) => ({
        nameUk: ri.nameUk,
        amount: round1(ri.amount * scale),
        unit: (KNOWN_UNITS.has(ri.unit) ? ri.unit : "g") as "g" | "ml" | "pcs" | "kg" | "l",
        optional: ri.optional,
      })),
      macrosPerServing: item.macrosPerServing,
      allergens: recipe.allergens,
    },
  };
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
  const stage = opts.onStage ?? ((s: PlanGenStage) => void setGenStage(householdId, s));
  const detachExplanation = opts.detachExplanation ?? true;

  let ctx: PlanContext;
  let mcpRecords: McpCallRecord[] = [];
  try {
    const traced = await runWithMcpTrace({ phase: "plan_generate" }, () =>
      buildPlanContext(householdId, retail, { ...opts, onStage: stage }),
    );
    ctx = traced.result;
    mcpRecords = traced.records;
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

  stage("solving");
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

  // The mapper priced the whole corpus at each recipe's own yield; the shopping list must
  // reflect the 5 chosen dinners × servings × portion scale (R0).
  const sizedMapper = ctx.mapperResult
    ? resizePlanList(
        ctx.mapperResult,
        result.days,
        ctx.input.candidates,
        ctx.input.servings,
        ctx.idBySlug,
      )
    : emptyMapper;

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
    mapper: sizedMapper,
    idBySlug: ctx.idBySlug,
    recipeSlugIngredients: ctx.recipeSlugIngredients,
  });

  stage("saving");
  const planId = await savePlan(rows);
  // Both best-effort and independent: the solver input for plan.replaceItem / plan.cheaper
  // (T4.2, avoids the corpus re-map) and the MCP-call trace for ops.trace (T4.3).
  await Promise.all([
    savePlanContext(planId, toCacheable(ctx)),
    persistMcpTrace(mcpRecords, { planId, householdId, phase: "plan_generate" }),
  ]);

  // The explanation is cosmetic and `plan.get` tolerates its absence — write it in the
  // background so the Guest sees the plan ~3 s sooner (T4.5). `plan:probe` / tests await it.
  const writeExplanation = async () => {
    stage("explaining");
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
    await setPlanExplanation(planId, householdId, explain.value.text, explain.source);
  };
  if (detachExplanation) {
    void writeExplanation().catch((e) =>
      console.warn(`[plan] explanation write failed for ${planId}:`, e),
    );
  } else {
    await writeExplanation();
  }

  stage("done");
  return { status: "ok", planId };
}
