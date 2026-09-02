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

// ─── structural solver types (no @navar/planner import) ───────────────────────

interface DayPick {
  day: number;
  recipeId: string;
  slug: string;
  titleUk: string;
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
  text: string,
  database: Db = db,
): Promise<void> {
  await database.update(plans).set({ explanation: text }).where(eq(plans.id, planId));
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

  const header: Plan = {
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
    createdAt: row.createdAt.toISOString(),
  };

  const items: PlanItem[] = row.items.map((i) => ({
    dayIndex: i.dayIndex,
    recipeId: i.recipeId,
    slug: i.slug,
    titleUk: i.titleUk,
    servings: i.servings,
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
  return rows.map((row) => ({
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
    createdAt: row.createdAt.toISOString(),
  }));
}
