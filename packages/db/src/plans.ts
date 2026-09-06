/**
 * Persist a generated meal plan — the solver's picks (`plan_items`) and the mapper's
 * shopping list for those picks (`list_lines`) — and read it back for `plan.get`
 * (roadmap T2.4, TDD §3 / §7, `FR-PLAN-005`, `AC-P0-09`, `NFR-PERF-001`).
 *
 * Deterministic, never the LLM (ADR-02). The row-shaping (`toPlanRows`) is a pure helper
 * split from the DB writes (`savePlan` / `getPlanDetail`) so it unit-tests without a
 * database — the `receipt-lines.ts` pattern. It takes structural types, not
 * `@navar/planner`'s, so `@navar/db` keeps no dependency on the solver package.
 */

import type {
  MapperResult,
  Plan,
  PlanDetail,
  PlanItem,
  ListLine,
  ServingMacros,
} from "@navar/domain";
import { and, eq } from "drizzle-orm";

import { db, type Db } from "./client.js";
import { listLines, planItems, plans } from "./schema.js";

const num = (v: number, dp: number): string => v.toFixed(dp);
const toNum = (v: string | null): number | null => (v == null ? null : Number(v));

/** A `plans` row → the `Plan` header shape (`plan.get` / `plan.list` share it). */
function toPlanHeader(row: typeof plans.$inferSelect): Plan {
  return {
    id: row.id,
    goal: row.goal as Plan["goal"],
    seed: Number(row.seed),
    days: row.days,
    budgetUah: Number(row.budgetUah),
    status: row.status as Plan["status"],
    totalEstUah: toNum(row.totalEstUah),
    promoSharePct: row.promoShare == null ? null : Number(row.promoShare) * 100,
    estimatedCostUah: toNum(row.estimatedCostUah),
    unpricedLineCount: row.unpricedLineCount,
    proteinFloorMet: row.proteinFloorMet,
    kcalCorridorMet: row.kcalCorridorMet,
    explanation: row.explanation,
    explanationSource: row.explanationSource as Plan["explanationSource"],
    cartId: row.cartId,
    materializedAt: row.materializedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── structural solver types (no @navar/planner import) ───────────────────────

interface DayPick {
  day: number;
  recipeId: string;
  slug: string;
  titleUk: string;
  portionScale: number;
  costUah: number;
  promoShareUah: number;
  macrosPerServing: ServingMacros & { fiber?: number };
}

interface PlanTotalsLike {
  costUah: number;
  promoSharePct: number;
  estimatedCostUah: number;
  unpricedLineCount: number;
  proteinFloorMet: boolean;
  kcalCorridorMet: boolean;
}

export interface ToPlanRowsInput {
  householdId: string;
  goal: string;
  seed: number;
  days: number;
  budgetUah: number;
  servings: number;
  picks: readonly DayPick[];
  totals: PlanTotalsLike;
  /** The mapper output for the whole run; `toPlanRows` keeps only the chosen recipes' lines. */
  mapper: MapperResult;
  /** canonical_ingredients slug → id. */
  idBySlug: ReadonlyMap<string, string>;
  /** slug → the recipe ingredient slugs used by each chosen recipe (to filter `list_lines`). */
  recipeSlugIngredients: ReadonlyMap<string, readonly string[]>;
}

export interface PlanRows {
  plan: typeof plans.$inferInsert;
  items: (typeof planItems.$inferInsert)[];
  lines: Omit<typeof listLines.$inferInsert, "planId">[];
}

/**
 * Shape a feasible solver result + its mapper output into `plans` / `plan_items` /
 * `list_lines` insert rows. `list_lines` is the mapper's matches **restricted to the
 * ingredients of the chosen recipes** — not the whole corpus the solver priced.
 */
export function toPlanRows(input: ToPlanRowsInput): Omit<PlanRows, "plan"> & {
  plan: Omit<typeof plans.$inferInsert, "id">;
} {
  const { totals } = input;

  const plan: Omit<typeof plans.$inferInsert, "id"> = {
    householdId: input.householdId,
    goal: input.goal,
    seed: input.seed,
    days: input.days,
    budgetUah: num(input.budgetUah, 2),
    status: "draft",
    totalEstUah: num(totals.costUah, 2),
    promoShare: num(totals.promoSharePct / 100, 3),
    estimatedCostUah: num(totals.estimatedCostUah, 2),
    unpricedLineCount: totals.unpricedLineCount,
    proteinFloorMet: totals.proteinFloorMet,
    kcalCorridorMet: totals.kcalCorridorMet,
  };

  const items = input.picks.map((p) => ({
    planId: "", // set by savePlan
    dayIndex: p.day,
    recipeId: p.recipeId || null,
    slug: p.slug,
    titleUk: p.titleUk,
    servings: input.servings,
    portionScale: num(p.portionScale, 2),
    costUah: num(p.costUah, 2),
    promoShareUah: num(p.promoShareUah, 2),
    kcalServing: p.macrosPerServing ? num(p.macrosPerServing.kcal, 2) : null,
    proteinServing: p.macrosPerServing ? num(p.macrosPerServing.protein, 2) : null,
    fatServing: p.macrosPerServing ? num(p.macrosPerServing.fat, 2) : null,
    carbsServing: p.macrosPerServing ? num(p.macrosPerServing.carbs, 2) : null,
  })) as (typeof planItems.$inferInsert)[];

  // Ingredients the chosen dinners actually need.
  const wanted = new Set<string>();
  for (const p of input.picks) {
    for (const slug of input.recipeSlugIngredients.get(p.slug) ?? []) wanted.add(slug);
  }

  const lines = input.mapper.matches
    .filter((m) => wanted.has(m.slug))
    .map((m) => {
      const ingredientId = input.idBySlug.get(m.slug);
      if (!ingredientId) return null;
      const match = m.match;
      return {
        ingredientId,
        slug: m.slug,
        nameUk: m.ingredientNameUk,
        neededAmount: num(m.neededAmount, 2),
        unit: m.neededUnit,
        productRef: match?.productId ?? null,
        externalProductId:
          match?.externalProductId != null ? String(match.externalProductId) : null,
        companyId: match?.companyId ?? null,
        branchId: match?.branchId ?? null,
        productName: match?.name ?? null,
        packSize: m.packSize != null ? num(m.packSize, 2) : null,
        packCount: m.packCount,
        price: match ? num(match.price, 2) : null,
        oldPrice: match?.oldPrice != null ? num(match.oldPrice, 2) : null,
        isPromo: m.isPromo,
        confidence: num(m.confidence, 2),
        decision: m.decision,
        needsConfirmation: m.needsConfirmation,
        outOfStock: m.outOfStock,
        blockReason: m.blockReason,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { plan, items, lines };
}

// ─── DB I/O ──────────────────────────────────────────────────────────────────

/** Insert a plan + its items + list lines in one transaction. Returns the new plan id. */
export async function savePlan(
  rows: Omit<PlanRows, "plan"> & { plan: Omit<typeof plans.$inferInsert, "id"> },
  database: Db = db,
): Promise<string> {
  return database.transaction(async (tx) => {
    const [row] = await tx.insert(plans).values(rows.plan).returning({ id: plans.id });
    const planId = row!.id;
    if (rows.items.length > 0) {
      await tx.insert(planItems).values(rows.items.map((i) => ({ ...i, planId })));
    }
    if (rows.lines.length > 0) {
      await tx.insert(listLines).values(rows.lines.map((l) => ({ ...l, planId })));
    }
    return planId;
  });
}

export async function setPlanExplanation(
  planId: string,
  householdId: string,
  text: string,
  source: "llm" | "fallback",
  database: Db = db,
): Promise<void> {
  await database
    .update(plans)
    .set({ explanation: text, explanationSource: source })
    .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)));
}

/**
 * Record that a plan's shopping list was written into a Silpo cart (roadmap T3.1). Scoped
 * to `householdId`; idempotent — a re-materialize just refreshes `materializedAt` (the
 * Silpo write itself is set-semantics). Returns the number of rows touched (0 = not found /
 * not this household).
 */
export async function markPlanMaterialized(
  planId: string,
  householdId: string,
  cartId: string,
  database: Db = db,
): Promise<number> {
  const rows = await database
    .update(plans)
    .set({ status: "materialized", cartId, materializedAt: new Date() })
    .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)))
    .returning({ id: plans.id });
  return rows.length;
}

/** `plan.get` — a plan + its dinners + shopping list, or `null`. Scoped to `householdId`. */
export async function getPlanDetail(
  planId: string,
  householdId: string,
  database: Db = db,
): Promise<PlanDetail | null> {
  const row = await database.query.plans.findFirst({
    where: (p, { eq: e }) => and(e(p.id, planId), e(p.householdId, householdId)),
    with: {
      items: { orderBy: (i, { asc }) => asc(i.dayIndex) },
      list: { orderBy: (l, { asc }) => asc(l.slug) },
    },
  });
  if (!row) return null;

  const header = toPlanHeader(row);

  const items: PlanItem[] = row.items.map((i) => ({
    dayIndex: i.dayIndex,
    recipeId: i.recipeId,
    slug: i.slug,
    titleUk: i.titleUk,
    servings: i.servings,
    portionScale: Number(i.portionScale),
    costUah: Number(i.costUah),
    promoShareUah: Number(i.promoShareUah),
    macrosPerServing:
      i.kcalServing == null
        ? null
        : {
            kcal: Number(i.kcalServing),
            protein: Number(i.proteinServing ?? 0),
            fat: Number(i.fatServing ?? 0),
            carbs: Number(i.carbsServing ?? 0),
          },
    pinned: i.pinned,
    outcome: i.outcome as PlanItem["outcome"],
  }));

  const list: ListLine[] = row.list.map((l) => ({
    ingredientId: l.ingredientId,
    slug: l.slug,
    nameUk: l.nameUk,
    neededAmount: Number(l.neededAmount),
    unit: l.unit,
    productRef: l.productRef,
    externalProductId: l.externalProductId,
    companyId: l.companyId,
    branchId: l.branchId,
    productName: l.productName,
    packSize: toNum(l.packSize),
    packCount: l.packCount,
    price: toNum(l.price),
    oldPrice: toNum(l.oldPrice),
    isPromo: l.isPromo,
    confidence: toNum(l.confidence),
    decision: l.decision as ListLine["decision"],
    needsConfirmation: l.needsConfirmation,
    outOfStock: l.outOfStock,
    blockReason: l.blockReason,
    userOverridden: l.userOverridden,
  }));

  return { ...header, items, list };
}

/** Recent plan headers for a household (`plan.list`). */
export async function listPlans(
  householdId: string,
  limit = 20,
  database: Db = db,
): Promise<Plan[]> {
  const rows = await database.query.plans.findMany({
    where: (p, { eq: e }) => e(p.householdId, householdId),
    orderBy: (p, { desc }) => desc(p.createdAt),
    limit,
  });
  return rows.map(toPlanHeader);
}

// ─── in-place edits (T4.2, FR-PLAN-007/008) ─────────────────────────────────

/**
 * Overwrite one day of a saved plan (`plan.applyReplacement`). `plan_items`' primary key is
 * `(plan_id, day_index)`, so a single-day swap is a plain targeted update — the other days
 * are not touched.
 *
 * Household-scoped like `markPlanMaterialized`: the plan id alone is not an authorisation.
 * Returns the number of rows changed, so the caller can tell "wrong household / no such day"
 * from a successful write.
 */
export async function updatePlanDay(
  planId: string,
  householdId: string,
  dayIndex: number,
  item: Omit<typeof planItems.$inferInsert, "planId" | "dayIndex">,
  database: Db = db,
): Promise<number> {
  return database.transaction(async (tx) => {
    const owned = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)));
    if (owned.length === 0) return 0;

    const rows = await tx
      .update(planItems)
      .set(item)
      .where(and(eq(planItems.planId, planId), eq(planItems.dayIndex, dayIndex)))
      .returning({ dayIndex: planItems.dayIndex });
    return rows.length;
  });
}

/**
 * Replace a saved plan's whole body — header totals, every day, and the shopping list
 * (`plan.cheaper`, and `applyReplacement` for the recomputed list `FR-PLAN-007` demands).
 *
 * `plan_items` and `list_lines` are deleted and reinserted rather than diffed: `list_lines`
 * has a `bigserial` surrogate key and no natural key to match on, so a wholesale replace is
 * both simpler and the only way to guarantee no orphans. One transaction, mirroring
 * `savePlan` — a partial rewrite would leave a plan whose list does not match its days.
 *
 * The plan's identity columns (`id`, `household_id`, `seed`, `goal`, `created_at`) are never
 * touched; `budget_uah` is, because `cheaper` is precisely a change of budget.
 */
export async function replacePlanRows(
  planId: string,
  householdId: string,
  rows: Omit<PlanRows, "plan"> & { plan: Omit<typeof plans.$inferInsert, "id"> },
  database: Db = db,
): Promise<number> {
  return database.transaction(async (tx) => {
    const updated = await tx
      .update(plans)
      .set({
        budgetUah: rows.plan.budgetUah,
        totalEstUah: rows.plan.totalEstUah,
        promoShare: rows.plan.promoShare,
        estimatedCostUah: rows.plan.estimatedCostUah,
        unpricedLineCount: rows.plan.unpricedLineCount,
        proteinFloorMet: rows.plan.proteinFloorMet,
        kcalCorridorMet: rows.plan.kcalCorridorMet,
      })
      .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)))
      .returning({ id: plans.id });
    if (updated.length === 0) return 0;

    await tx.delete(planItems).where(eq(planItems.planId, planId));
    await tx.delete(listLines).where(eq(listLines.planId, planId));
    if (rows.items.length > 0) {
      await tx.insert(planItems).values(rows.items.map((i) => ({ ...i, planId })));
    }
    if (rows.lines.length > 0) {
      await tx.insert(listLines).values(rows.lines.map((l) => ({ ...l, planId })));
    }
    return 1;
  });
}
