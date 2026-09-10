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
import { and, eq, inArray } from "drizzle-orm";

import { db, type Db } from "./client.js";
import {
  canonicalIngredients,
  listLines,
  planItems,
  plans,
  recipeIngredients,
  recipes,
} from "./schema.js";

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
    // Computed from `list_lines` in `getPlanDetail`; null here (list-header contexts).
    savingsUah: null,
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
        quantityKg: m.quantityKg != null ? num(m.quantityKg, 3) : null,
        price: match ? num(match.price, 2) : null,
        oldPrice: match?.oldPrice != null ? num(match.oldPrice, 2) : null,
        isPromo: m.isPromo,
        confidence: num(m.confidence, 2),
        decision: m.decision,
        replacedFromName: m.replacedFromName ?? null,
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

/**
 * `plan.delete` (R8) — a hard delete of one plan, scoped to `householdId`. `plan_items`,
 * `list_lines` and `mcp_call_log` are `ON DELETE cascade`, so this is the only row to touch.
 * Never touches the Silpo cart of a materialized plan (`FR-CART-004`). Returns the number of
 * rows deleted (0 = not found / not this household).
 */
export async function deletePlan(
  planId: string,
  householdId: string,
  database: Db = db,
): Promise<number> {
  const rows = await database
    .delete(plans)
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
      items: {
        orderBy: (i, { asc }) => asc(i.dayIndex),
        with: { recipe: { columns: { totalMinutes: true } } },
      },
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
    totalMinutes: i.recipe?.totalMinutes ?? null,
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
    quantityKg: toNum(l.quantityKg),
    price: toNum(l.price),
    oldPrice: toNum(l.oldPrice),
    isPromo: l.isPromo,
    confidence: toNum(l.confidence),
    decision: l.decision as ListLine["decision"],
    replacedFromName: l.replacedFromName,
    needsConfirmation: l.needsConfirmation,
    outOfStock: l.outOfStock,
    blockReason: l.blockReason,
    userOverridden: l.userOverridden,
  }));

  // B3 — the promo savings figure the plan screen shows ("зекономлено N ₴").
  const savingsUah =
    Math.round(
      list.reduce(
        (sum, l) =>
          l.isPromo && l.oldPrice != null && l.price != null
            ? sum + Math.max(0, l.oldPrice - l.price) * (l.quantityKg ?? l.packCount)
            : sum,
        0,
      ) * 100,
    ) / 100;

  return { ...header, savingsUah, items, list };
}

/** Structural input for `toPlanRecipeView` (R2) — the raw plan-item + its recipe, no scaling. */
export interface PlanRecipeRow {
  item: {
    dayIndex: number;
    titleUk: string;
    servings: number;
    portionScale: number;
    macrosPerServing: ServingMacros | null;
  };
  /** `null` when the recipe was pruned from the corpus (`plan_items.recipe_id` → SET NULL). */
  recipe: {
    servings: number;
    steps: string[];
    totalMinutes: number | null;
    activeMinutes: number | null;
    difficulty: number | null;
    allergens: string[];
    ingredients: { nameUk: string; amount: number; unit: string; optional: boolean }[];
  } | null;
}

/**
 * `plan.recipe` — one dinner + its recipe steps/ingredients, household-scoped. No scaling
 * here (that is `toPlanRecipeView`, pure + tested). `null` = plan not this household / no
 * such day. Falls back to a slug lookup when `plan_items.recipe_id` is null.
 */
export async function getPlanRecipe(
  planId: string,
  householdId: string,
  day: number,
  database: Db = db,
): Promise<PlanRecipeRow | null> {
  const recipeWith = {
    ingredients: { with: { ingredient: { columns: { nameUk: true } } } },
  } as const;

  const row = await database.query.plans.findFirst({
    where: (p, { eq: e }) => and(e(p.id, planId), e(p.householdId, householdId)),
    columns: { id: true },
    with: {
      items: {
        where: (i, { eq: e }) => e(i.dayIndex, day),
        with: { recipe: { with: recipeWith } },
      },
    },
  });
  if (!row || row.items.length === 0) return null;
  const it = row.items[0]!;

  const recipeRow =
    it.recipe ??
    (await database.query.recipes.findFirst({
      where: (r, { eq: e }) => e(r.slug, it.slug),
      with: recipeWith,
    })) ??
    null;

  return {
    item: {
      dayIndex: it.dayIndex,
      titleUk: it.titleUk,
      servings: it.servings,
      portionScale: Number(it.portionScale),
      macrosPerServing:
        it.kcalServing == null
          ? null
          : {
              kcal: Number(it.kcalServing),
              protein: Number(it.proteinServing ?? 0),
              fat: Number(it.fatServing ?? 0),
              carbs: Number(it.carbsServing ?? 0),
            },
    },
    recipe: recipeRow
      ? {
          servings: recipeRow.servings,
          steps: recipeRow.steps,
          totalMinutes: recipeRow.totalMinutes,
          activeMinutes: recipeRow.activeMinutes,
          difficulty: recipeRow.difficulty,
          allergens: recipeRow.allergens,
          ingredients: recipeRow.ingredients.map((ri) => ({
            nameUk: ri.ingredient.nameUk,
            amount: Number(ri.amount),
            unit: ri.unit,
            optional: ri.optional,
          })),
        }
      : null,
  };
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

/** The product columns a manual SKU swap on the cart preview rewrites (`cart.setLineSku`). */
export interface ListLineSkuPatch {
  productRef: string | null;
  externalProductId: string | null;
  companyId: string | null;
  branchId: string | null;
  productName: string | null;
  packSize: number | null;
  packCount: number;
  quantityKg: number | null;
  price: number | null;
  oldPrice: number | null;
  isPromo: boolean;
  confidence: number | null;
  decision: string;
  replacedFromName: string | null;
  needsConfirmation: boolean;
  outOfStock: boolean;
  blockReason: string | null;
  userOverridden: boolean;
}

/**
 * Rewrite one `list_lines` row's product columns (`cart.setLineSku` — the Guest picked a
 * different SKU on the preview). `slug` is unique per plan (`toPlanRows` builds one line per
 * consolidated ingredient); `ingredient_id` / `needed_amount` / `unit` are never touched.
 * Household-scoped like `updatePlanDay`. Returns the number of rows changed.
 */
export async function updateListLineSku(
  planId: string,
  householdId: string,
  slug: string,
  patch: ListLineSkuPatch,
  database: Db = db,
): Promise<number> {
  return database.transaction(async (tx) => {
    const owned = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)));
    if (owned.length === 0) return 0;

    const rows = await tx
      .update(listLines)
      .set({
        productRef: patch.productRef,
        externalProductId: patch.externalProductId,
        companyId: patch.companyId,
        branchId: patch.branchId,
        productName: patch.productName,
        packSize: patch.packSize == null ? null : num(patch.packSize, 2),
        packCount: patch.packCount,
        quantityKg: patch.quantityKg == null ? null : num(patch.quantityKg, 3),
        price: patch.price == null ? null : num(patch.price, 2),
        oldPrice: patch.oldPrice == null ? null : num(patch.oldPrice, 2),
        isPromo: patch.isPromo,
        confidence: patch.confidence == null ? null : num(patch.confidence, 2),
        decision: patch.decision,
        replacedFromName: patch.replacedFromName,
        needsConfirmation: patch.needsConfirmation,
        outOfStock: patch.outOfStock,
        blockReason: patch.blockReason,
        userOverridden: patch.userOverridden,
      })
      .where(and(eq(listLines.planId, planId), eq(listLines.slug, slug)))
      .returning({ id: listLines.id });
    return rows.length;
  });
}

/**
 * Cut one `list_lines` row's quantity down (`cart.reduceLine` — a materialized line the
 * branch cannot fulfil in full). Only `pack_count` / `quantity_kg` move; the SKU and every
 * other column stay. Household-scoped like `updateListLineSku`. Returns rows changed.
 */
export async function updateListLineQuantity(
  planId: string,
  householdId: string,
  slug: string,
  qty: { packCount: number; quantityKg: number | null },
  database: Db = db,
): Promise<number> {
  return database.transaction(async (tx) => {
    const owned = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)));
    if (owned.length === 0) return 0;

    const rows = await tx
      .update(listLines)
      .set({
        packCount: qty.packCount,
        quantityKg: qty.quantityKg == null ? null : num(qty.quantityKg, 3),
      })
      .where(and(eq(listLines.planId, planId), eq(listLines.slug, slug)))
      .returning({ id: listLines.id });
    return rows.length;
  });
}

/**
 * Flag `list_lines` rows as out of stock by their Silpo `product_ref` (`cart.checkoutInStock`
 * — the Guest dropped the shorted lines and checked out the rest). Best-effort: keeps the
 * same plan's later `preview` / `liveState` from re-adding them. Household-scoped. Returns
 * rows changed.
 */
export async function markListLinesOutOfStock(
  planId: string,
  householdId: string,
  productRefs: readonly string[],
  database: Db = db,
): Promise<number> {
  if (productRefs.length === 0) return 0;
  return database.transaction(async (tx) => {
    const owned = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)));
    if (owned.length === 0) return 0;

    const rows = await tx
      .update(listLines)
      .set({ outOfStock: true })
      .where(and(eq(listLines.planId, planId), inArray(listLines.productRef, [...productRefs])))
      .returning({ id: listLines.id });
    return rows.length;
  });
}

/**
 * `ingredient slug → plan day numbers that cook with it` (C — the «Замінити страву» action
 * on a protein line the branch can't source fresh). Joins `plan_items` to `recipes` by
 * **slug** (`recipe_id` may be null after a corpus re-import) → `recipe_ingredients` →
 * `canonical_ingredients`. Household-scoped.
 */
export async function getPlanLineDays(
  planId: string,
  householdId: string,
  database: Db = db,
): Promise<Map<string, number[]>> {
  const owned = await database
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)));
  if (owned.length === 0) return new Map();

  const rows = await database
    .select({ day: planItems.dayIndex, slug: canonicalIngredients.slug })
    .from(planItems)
    .innerJoin(recipes, eq(recipes.slug, planItems.slug))
    .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
    .innerJoin(canonicalIngredients, eq(canonicalIngredients.id, recipeIngredients.ingredientId))
    .where(eq(planItems.planId, planId));

  const out = new Map<string, number[]>();
  for (const r of rows) {
    const days = out.get(r.slug) ?? [];
    if (!days.includes(r.day)) days.push(r.day);
    out.set(r.slug, days);
  }
  for (const days of out.values()) days.sort((a, b) => a - b);
  return out;
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
