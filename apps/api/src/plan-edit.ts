import { getPlanDetail, replacePlanRows, setPlanExplanation, toPlanRows } from "@navar/db";
import type {
  ExplainChangeInput,
  MapperResult,
  PlanAlternative,
  PlanChange,
  PlanDetail,
  PlanEditResult,
  PlanItem,
  PlanReplaceItemResult,
} from "@navar/domain";
import { explainChangeStep, runStep } from "@navar/llm";
import {
  type DayAlternative,
  dayAlternatives,
  generatePlan,
  hardFilter,
  type PlanDayPick,
  type PlanTotals,
  planTotals,
  type RecipeCandidate,
  replay,
  type ReplayResult,
  type SolverInput,
} from "@navar/planner";
import { AuthRequiredError, NoCartError, type RetailProvider } from "@navar/retail";

import { clearPreview } from "./cart.js";
import { getLlm, getLlmTracer } from "./llm.js";
import {
  type CachedPlanContext,
  loadPlanContext,
  savePlanContext,
  toCacheable,
} from "./plan-context-cache.js";
import { buildPlanContext, toNearestView } from "./plan.js";

/**
 * Plan edits (T4.2, `FR-PLAN-007/008`) — swap one dish, or rebuild under a lower budget.
 *
 * Kept out of `plan.ts` so generation and editing stay separately readable. Both mutations
 * rewrite the saved plan **in place**, which makes two guards load-bearing (see
 * `guardEditable`).
 */

type RetailErrResult =
  | { status: "auth_required"; hint?: string }
  | { status: "no_cart"; hint?: string }
  | { status: "error"; message: string };

function retailError(err: unknown): RetailErrResult {
  if (err instanceof AuthRequiredError) return { status: "auth_required", hint: err.hint };
  if (err instanceof NoCartError) return { status: "no_cart", hint: err.message };
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

/** `numeric(3,2)` in Postgres — round before replaying so a reloaded plan re-costs identically. */
export function roundScale(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A saved plan's days as `replay`'s input. `plan_items.recipe_id` is nullable (the recipe
 * importer prunes with `ON DELETE SET NULL`), so the candidate is matched by `slug` — which
 * is stable — and `recipeId` is only a fast path.
 */
export function assignmentFrom(
  items: readonly PlanItem[],
  candidates: readonly RecipeCandidate[],
): { recipeId: string; portionScale: number }[] | null {
  const byId = new Map(candidates.map((c) => [c.recipeId, c]));
  const bySlug = new Map(candidates.map((c) => [c.slug, c]));
  const out: { recipeId: string; portionScale: number }[] = [];
  for (const item of [...items].sort((a, b) => a.dayIndex - b.dayIndex)) {
    const c = (item.recipeId ? byId.get(item.recipeId) : undefined) ?? bySlug.get(item.slug);
    if (!c) return null; // a dish the corpus no longer has — the plan can't be replayed
    out.push({ recipeId: c.recipeId, portionScale: roundScale(item.portionScale) });
  }
  return out;
}

/** `form` mode is read off the constraints, never off `goal` (ADR-09). */
const isFormInput = (input: SolverInput): boolean =>
  input.hardConstraints.proteinMinPerDay != null || input.hardConstraints.kcalRange != null;

/**
 * The plan's solver context — from Redis when it is still warm, otherwise rebuilt.
 *
 * A rebuild is correct but costs ~13.7 s (the mapper re-prices the whole corpus), which
 * blows `NFR-PERF-003`'s 8 s. It is logged, not silently absorbed, so a persistently cold
 * cache is visible rather than merely slow.
 */
async function contextFor(
  planId: string,
  householdId: string,
  retail: RetailProvider,
  plan: PlanDetail,
): Promise<CachedPlanContext> {
  const cached = await loadPlanContext(planId);
  if (cached) return cached;

  console.warn(`[plan-edit] context cache miss for ${planId} — rebuilding (slow)`);
  const rebuilt = await buildPlanContext(householdId, retail, {
    goal: plan.goal,
    days: plan.days,
    budgetUah: plan.budgetUah,
    seed: plan.seed,
  });
  if (rebuilt.retailError) throw rebuilt.retailError;
  const cacheable = toCacheable(rebuilt);
  await savePlanContext(planId, cacheable);
  return cacheable;
}

/**
 * Common guard for both mutations. Order matters: ownership first (so a foreign plan is
 * indistinguishable from a missing one), then the materialize freeze.
 *
 * **Why the materialize refusal is not optional:** `cart.materializePlan` re-reads
 * `list_lines` at write time, and `addCartProducts` sets an absolute quantity *per product*
 * while never removing anything. Editing a plan whose cart already exists and
 * re-materializing would therefore add the new dish's SKUs and leave the old dish's SKUs in
 * the Guest's cart — they would pay for both.
 */
function guardEditable(plan: PlanDetail | null): PlanEditResult | null {
  if (!plan) return { status: "not_found" };
  if (plan.status === "materialized" || plan.status === "checked_out" || plan.cartId != null) {
    return {
      status: "already_materialized",
      reason:
        "Цей план вже зібрано в кошик Сільпо. Щоб змінити меню, створіть новий план — " +
        "інакше кошик і план розійдуться.",
    };
  }
  return null;
}

function toAlternative(alt: DayAlternative, dayIdx: number): PlanAlternative {
  const pick = alt.replayed.picks[dayIdx]!;
  const total = alt.replayed.totalCost;
  const promo = alt.replayed.picks.reduce((s, p) => s + p.promoShareUah, 0);
  return {
    recipeId: alt.candidate.recipeId,
    slug: alt.candidate.slug,
    titleUk: alt.candidate.titleUk,
    portionScale: roundScale(pick.portionScale),
    costUah: pick.costUah,
    deltaUah: alt.deltaUah,
    macrosPerServing: pick.macrosPerServing,
    totalUah: total,
    promoSharePct: total > 0 ? Math.min(100, Math.round((promo / total) * 1000) / 10) : 0,
  };
}

/**
 * `plan.replaceItem` — the 3 alternatives for one day (`FR-PLAN-007`). Read-only: it writes
 * nothing, so the Guest can look before committing (the same preview→commit shape as the
 * cart, ADR-07).
 */
export async function proposeReplacements(
  planId: string,
  householdId: string,
  day: number,
  retail: RetailProvider,
): Promise<PlanReplaceItemResult> {
  try {
    const plan = await getPlanDetail(planId, householdId);
    if (!plan) return { status: "not_found" };

    const ctx = await contextFor(planId, householdId, retail, plan);
    const hf = hardFilter(ctx.input);
    const assignment = assignmentFrom(plan.items, hf.kept);
    if (!assignment) return { status: "ok", day, current: null, alternatives: [] };

    const byId = new Map(hf.kept.map((c) => [c.recipeId, c]));
    const current = replay(assignment, byId, ctx.input);
    if (!current) return { status: "ok", day, current: null, alternatives: [] };

    const dayIdx = day - 1;
    const alts = dayAlternatives(dayIdx, current, hf.kept, byId, ctx.input, isFormInput(ctx.input));
    const currentPick = current.picks[dayIdx];

    return {
      status: "ok",
      day,
      current: currentPick
        ? toAlternative(
            { candidate: byId.get(currentPick.recipeId)!, replayed: current, deltaUah: 0 },
            dayIdx,
          )
        : null,
      alternatives: alts.map((a) => toAlternative(a, dayIdx)),
    };
  } catch (err) {
    return retailError(err);
  }
}

/** Rebuild every persisted row for a changed plan, then write it in one transaction. */
async function persistEdit(
  planId: string,
  householdId: string,
  plan: PlanDetail,
  ctx: CachedPlanContext,
  picks: readonly PlanDayPick[],
  totals: PlanTotals,
  budgetUah: number,
): Promise<void> {
  const emptyMapper: MapperResult = {
    branchId: "",
    consolidated: [],
    matches: [],
    stats: { total: 0, matched: 0, needsConfirmation: 0, noMatch: 0, blocked: 0 },
  };
  const rows = toPlanRows({
    householdId,
    goal: plan.goal,
    seed: plan.seed,
    days: plan.days,
    budgetUah,
    servings: ctx.input.servings,
    picks,
    totals: {
      costUah: totals.costUah,
      promoSharePct: totals.promoSharePct,
      estimatedCostUah: totals.estimatedCostUah,
      unpricedLineCount: totals.unpricedLineCount,
      proteinFloorMet: totals.proteinFloorMet,
      kcalCorridorMet: totals.kcalCorridorMet,
    },
    mapper: ctx.mapperResult ?? emptyMapper,
    idBySlug: ctx.idBySlug,
    recipeSlugIngredients: ctx.recipeSlugIngredients,
  });
  await replacePlanRows(planId, householdId, rows);
}

/** Build the change record + its Guest-facing note, and store the note on the plan. */
async function describeChange(
  planId: string,
  householdId: string,
  kind: PlanChange["kind"],
  before: {
    picks: readonly { day: number; titleUk: string }[];
    totalUah: number;
    budgetUah: number;
    promoSharePct: number;
  },
  after: { picks: readonly PlanDayPick[]; totals: PlanTotals; budgetUah: number },
  goal: PlanDetail["goal"],
): Promise<PlanChange> {
  const beforeByDay = new Map(before.picks.map((p) => [p.day, p.titleUk]));
  const changedDays: number[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  for (const p of after.picks) {
    const was = beforeByDay.get(p.day);
    if (was != null && was !== p.titleUk) {
      changedDays.push(p.day);
      removed.push(was);
      added.push(p.titleUk);
    }
  }

  const input: ExplainChangeInput = {
    kind,
    goal,
    budgetBeforeUah: before.budgetUah,
    budgetAfterUah: after.budgetUah,
    totalBeforeUah: before.totalUah,
    totalAfterUah: after.totals.costUah,
    removedDishes: removed,
    addedDishes: added,
    changedDays,
    promoSharePctBefore: Math.min(100, Math.max(0, before.promoSharePct)),
    promoSharePctAfter: Math.min(100, Math.max(0, after.totals.promoSharePct)),
  };
  const explain = await runStep(explainChangeStep, input, {
    provider: getLlm(),
    tracer: getLlmTracer(),
  });
  await setPlanExplanation(planId, householdId, explain.value.text, explain.source);

  return {
    kind,
    totalBeforeUah: input.totalBeforeUah,
    totalAfterUah: input.totalAfterUah,
    budgetBeforeUah: input.budgetBeforeUah,
    budgetAfterUah: input.budgetAfterUah,
    removedDishes: removed,
    addedDishes: added,
    changedDays,
    promoSharePctBefore: input.promoSharePctBefore,
    promoSharePctAfter: input.promoSharePctAfter,
    note: explain.value.text,
  };
}

/**
 * `plan.applyReplacement` — commit one of the offered alternatives. Recomputes the whole
 * shopping list, which `FR-PLAN-007` («перераховує список») requires: swapping a dish
 * changes which SKUs are bought and in what quantity.
 */
export async function applyReplacement(
  planId: string,
  householdId: string,
  day: number,
  recipeId: string,
  retail: RetailProvider,
): Promise<PlanEditResult> {
  try {
    const plan = await getPlanDetail(planId, householdId);
    const blocked = guardEditable(plan);
    if (blocked) return blocked;

    const ctx = await contextFor(planId, householdId, retail, plan!);
    const hf = hardFilter(ctx.input);
    const assignment = assignmentFrom(plan!.items, hf.kept);
    if (!assignment) {
      return {
        status: "rejected",
        reason: "План не вдалося відтворити — страви більше немає в каталозі.",
      };
    }
    const byId = new Map(hf.kept.map((c) => [c.recipeId, c]));
    const current = replay(assignment, byId, ctx.input);
    if (!current) return { status: "rejected", reason: "План не вдалося відтворити." };

    const dayIdx = day - 1;
    // Re-derive the alternatives rather than trusting the id: it validates budget and every
    // hard constraint for this exact plan state, which a stale client id would not.
    const alts = dayAlternatives(
      dayIdx,
      current,
      hf.kept,
      byId,
      ctx.input,
      isFormInput(ctx.input),
      hf.kept.length,
    );
    const chosen = alts.find((a) => a.candidate.recipeId === recipeId);
    if (!chosen) {
      return {
        status: "rejected",
        reason:
          "Ця страва більше не підходить: вона не вкладається в бюджет або порушує обмеження.",
      };
    }

    const totals = planTotals(
      chosen.replayed.picks,
      chosen.replayed.pickCosts,
      chosen.replayed.finalPantry,
      ctx.input,
    );
    const beforeSnapshot = {
      picks: plan!.items.map((i) => ({ day: i.dayIndex, titleUk: i.titleUk })),
      totalUah: plan!.totalEstUah ?? current.totalCost,
      budgetUah: plan!.budgetUah,
      promoSharePct: plan!.promoSharePct ?? 0,
    };

    await persistEdit(
      planId,
      householdId,
      plan!,
      ctx,
      chosen.replayed.picks,
      totals,
      plan!.budgetUah,
    );
    await clearPreview(planId);

    const change = await describeChange(
      planId,
      householdId,
      "replace_item",
      beforeSnapshot,
      { picks: chosen.replayed.picks, totals, budgetUah: plan!.budgetUah },
      plan!.goal,
    );
    const updated = await getPlanDetail(planId, householdId);
    return updated ? { status: "ok", plan: updated, change } : { status: "not_found" };
  } catch (err) {
    return retailError(err);
  }
}

/**
 * `plan.cheaper(delta)` — rebuild under a lower budget (`FR-PLAN-008`, «перебудовує план»:
 * a full re-solve, not a local edit). The stored seed is reused, so the same plan and the
 * same delta always produce the same result (`FR-PLAN-005`).
 */
export async function makeCheaper(
  planId: string,
  householdId: string,
  deltaUah: number,
  retail: RetailProvider,
): Promise<PlanEditResult> {
  try {
    const plan = await getPlanDetail(planId, householdId);
    const blocked = guardEditable(plan);
    if (blocked) return blocked;
    if (!(deltaUah > 0)) {
      return { status: "rejected", reason: "Сума економії має бути більшою за нуль." };
    }

    const ctx = await contextFor(planId, householdId, retail, plan!);
    const budget = Math.max(0, Math.round((plan!.budgetUah - deltaUah) * 100) / 100);
    // `planTotals` reports against `input.budget`, so the lowered budget must go in here —
    // not just into the solve — or the saved plan would claim the old budget.
    const lowered: SolverInput = { ...ctx.input, budget, seed: plan!.seed };
    const result = generatePlan(lowered);

    if (!result.feasible) {
      const cheapest = result.nearest?.totals.costUah;
      return {
        status: "infeasible",
        binding: result.binding,
        // The solver's own strings are all phrased "на N ₴ більше" ("spend *more*"), which
        // reads backwards to a Guest who just asked to spend less.
        reason:
          cheapest != null
            ? `Не вдалося зекономити ${Math.round(deltaUah)} ₴ — найдешевший план коштує ${Math.round(cheapest)} ₴.`
            : result.reason,
        ...(result.shortfallUah != null ? { shortfallUah: result.shortfallUah } : {}),
        ...(result.nearest ? { nearest: toNearestView(result.nearest) } : {}),
      };
    }

    const beforeSnapshot = {
      picks: plan!.items.map((i) => ({ day: i.dayIndex, titleUk: i.titleUk })),
      totalUah: plan!.totalEstUah ?? 0,
      budgetUah: plan!.budgetUah,
      promoSharePct: plan!.promoSharePct ?? 0,
    };

    await persistEdit(planId, householdId, plan!, ctx, result.days, result.totals, budget);
    await clearPreview(planId);
    // The cached context now describes a plan built at a different budget.
    await savePlanContext(planId, { ...ctx, input: lowered });

    const change = await describeChange(
      planId,
      householdId,
      "cheaper",
      beforeSnapshot,
      { picks: result.days, totals: result.totals, budgetUah: budget },
      plan!.goal,
    );
    const updated = await getPlanDetail(planId, householdId);
    return updated ? { status: "ok", plan: updated, change } : { status: "not_found" };
  } catch (err) {
    return retailError(err);
  }
}

export type { ReplayResult };
