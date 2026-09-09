import { z } from "zod";

import { goalSchema, servingMacrosSchema } from "./schemas.js";
import { skuMatchDecisionSchema } from "./mapper.js";

/**
 * Persisted meal-plan contracts (roadmap T2.4, TDD §3 / §7). This is the *stored* shape
 * returned by the `plan.*` tRPC procedures — distinct from `@navar/planner`'s in-memory
 * `SolverResult`. Header numbers are snapshots taken at generation time.
 */

export const planStatusSchema = z.enum(["draft", "confirmed", "materialized", "checked_out"]);
export type PlanStatus = z.infer<typeof planStatusSchema>;

/** One dinner of a saved plan (`plan_items` row, display fields snapshotted). */
export const planItemSchema = z.object({
  dayIndex: z.number().int().positive(),
  recipeId: z.string().uuid().nullable(),
  slug: z.string(),
  titleUk: z.string(),
  servings: z.number().int().positive(),
  portionScale: z.number().min(0.6).max(1.4),
  costUah: z.number().nonnegative(),
  promoShareUah: z.number().nonnegative(),
  /** Total cook time from the linked recipe — `null` if the recipe was pruned from the corpus. */
  totalMinutes: z.number().int().nonnegative().nullable(),
  macrosPerServing: servingMacrosSchema.nullable(),
  pinned: z.boolean(),
  outcome: z.enum(["cooked", "skipped"]).nullable(),
});
export type PlanItem = z.infer<typeof planItemSchema>;

/** One shopping-list line (`list_lines` row) — a consolidated ingredient + its resolved SKU. */
export const listLineSchema = z.object({
  ingredientId: z.string().uuid(),
  slug: z.string(),
  nameUk: z.string(),
  neededAmount: z.number().nonnegative(),
  unit: z.string(),
  productRef: z.string().nullable(),
  externalProductId: z.string().nullable(),
  companyId: z.string().nullable(),
  branchId: z.string().nullable(),
  productName: z.string().nullable(),
  packSize: z.number().positive().nullable(),
  packCount: z.number().int().nonnegative(),
  /** Kilograms to add to the cart for a weighted line (MCP `1.109.8`); `null` for packaged goods. */
  quantityKg: z.number().positive().nullable(),
  price: z.number().nullable(),
  oldPrice: z.number().nullable(),
  isPromo: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  decision: skuMatchDecisionSchema.nullable(),
  /** The out-of-stock SKU this line replaced (`decision === "replacement"`); else `null`. */
  replacedFromName: z.string().nullable(),
  needsConfirmation: z.boolean(),
  outOfStock: z.boolean(),
  blockReason: z.string().nullable(),
  userOverridden: z.boolean(),
});
export type ListLine = z.infer<typeof listLineSchema>;

/** A saved plan header. */
export const planSchema = z.object({
  id: z.string().uuid(),
  goal: goalSchema,
  seed: z.number().int(),
  days: z.number().int().positive(),
  budgetUah: z.number().nonnegative(),
  status: planStatusSchema,
  totalEstUah: z.number().nonnegative().nullable(),
  promoSharePct: z.number().min(0).max(100).nullable(),
  /** Σ (oldPrice − price) × packCount over promo lines — `null` on `plan.list` (list not loaded). */
  savingsUah: z.number().nonnegative().nullable(),
  estimatedCostUah: z.number().nonnegative().nullable(),
  unpricedLineCount: z.number().int().nonnegative(),
  proteinFloorMet: z.boolean().nullable(),
  kcalCorridorMet: z.boolean().nullable(),
  explanation: z.string().nullable(),
  /** `runStep`'s `source` for `explanation` — `fallback` means the model never answered. */
  explanationSource: z.enum(["llm", "fallback"]).nullable(),
  /** The Silpo cart this plan was materialized into (T3.1) — `null` until `cart.materialize`. */
  cartId: z.string().nullable(),
  materializedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Plan = z.infer<typeof planSchema>;

/** A plan with its dinners + shopping list — the `plan.get` payload. */
export const planDetailSchema = planSchema.extend({
  items: z.array(planItemSchema),
  list: z.array(listLineSchema),
});
export type PlanDetail = z.infer<typeof planDetailSchema>;

// ── tRPC I/O ────────────────────────────────────────────────────────────────

export const planGenerateInputSchema = z.object({
  days: z.number().int().min(1).max(14).optional(),
  budgetUah: z.number().positive().optional(),
  seed: z.number().int().optional(),
  goal: goalSchema.optional(),
});
export type PlanGenerateInput = z.infer<typeof planGenerateInputSchema>;

/** Which hard constraint made an infeasible input infeasible (T2.5, `FR-PLAN-006`). */
export const infeasibleBindingSchema = z.enum([
  "budget",
  "protein",
  "portion",
  "kcal",
  "excluded_ingredients",
  "candidates",
]);
export type InfeasibleBinding = z.infer<typeof infeasibleBindingSchema>;

/** One dinner of the nearest valid plan returned alongside an infeasible verdict. */
export const nearestPlanDaySchema = z.object({
  day: z.number().int().positive(),
  slug: z.string(),
  titleUk: z.string(),
  costUah: z.number().nonnegative(),
  promoShareUah: z.number().nonnegative(),
  macrosPerServing: servingMacrosSchema,
});

/** The cheapest plan that honours every hard constraint (budget relaxed) — no SKU list in P0. */
export const nearestPlanSchema = z.object({
  days: z.array(nearestPlanDaySchema),
  costUah: z.number().nonnegative(),
  promoSharePct: z.number().min(0).max(100),
  proteinFloorMet: z.boolean(),
  kcalCorridorMet: z.boolean(),
});
export type NearestPlan = z.infer<typeof nearestPlanSchema>;

/**
 * `plan.generate` result. Only feasible plans are persisted; an infeasible input carries
 * the nearest valid plan + the ₴ delta + a concrete reason (T2.5, `FR-PLAN-006`).
 */
export const planGenerateResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), planId: z.string().uuid() }),
  z.object({
    status: z.literal("infeasible"),
    binding: infeasibleBindingSchema,
    reason: z.string(),
    shortfallUah: z.number().nonnegative().optional(),
    shortfallProteinG: z.number().nonnegative().optional(),
    nearest: nearestPlanSchema.optional(),
  }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type PlanGenerateResult = z.infer<typeof planGenerateResultSchema>;

export const planGetResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), plan: planDetailSchema }),
  z.object({ status: z.literal("not_found") }),
]);
export type PlanGetResult = z.infer<typeof planGetResultSchema>;

// ── plan.recipe — one dinner's cooking view (R2) ────────────────────────────

/**
 * One dinner of a saved plan as a cooking recipe: steps + ingredient amounts **scaled to
 * the household** (`servings / recipe.servings × portionScale`). Distinct from `PlanItem`
 * (header snapshot) — this is fetched on demand for the day screen, not part of `plan.get`.
 */
export const planRecipeSchema = z.object({
  dayIndex: z.number().int().positive(),
  titleUk: z.string(),
  totalMinutes: z.number().int().nonnegative().nullable(),
  activeMinutes: z.number().int().nonnegative().nullable(),
  difficulty: z.number().int().min(1).max(3).nullable(),
  /** Household servings for this dinner (the `plan_items` snapshot). */
  servings: z.number().int().positive(),
  portionScale: z.number().min(0.6).max(1.4),
  steps: z.array(z.string()),
  ingredients: z.array(
    z.object({
      nameUk: z.string(),
      amount: z.number().nonnegative(), // scaled; base recipe unit
      unit: z.enum(["g", "ml", "pcs", "kg", "l"]),
      optional: z.boolean(),
    }),
  ),
  /** Per-serving, from the item snapshot (already post-`portionScale`) — never recomputed. */
  macrosPerServing: servingMacrosSchema.nullable(),
  allergens: z.array(z.string()),
});
export type PlanRecipe = z.infer<typeof planRecipeSchema>;

export const planRecipeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), recipe: planRecipeSchema }),
  z.object({ status: z.literal("not_found") }),
  z.object({
    status: z.literal("recipe_unavailable"),
    titleUk: z.string(),
    dayIndex: z.number().int().positive(),
  }),
]);
export type PlanRecipeResult = z.infer<typeof planRecipeResultSchema>;

// ─── plan edits (T4.2, FR-PLAN-007/008) ─────────────────────────────────────

/** One offered substitution for a single day, with its whole-plan effect. */
export const planAlternativeSchema = z.object({
  recipeId: z.string(),
  slug: z.string(),
  titleUk: z.string(),
  portionScale: z.number().min(0.6).max(1.4),
  /** This dish's own cost on that day. */
  costUah: z.number().nonnegative(),
  /** Change in the **whole plan's** total — swapping one day re-prices the others. */
  deltaUah: z.number(),
  macrosPerServing: servingMacrosSchema,
  /** Plan total if this alternative were applied. */
  totalUah: z.number().nonnegative(),
  promoSharePct: z.number().min(0).max(100),
});
export type PlanAlternative = z.infer<typeof planAlternativeSchema>;

/**
 * A plan edit refused because the plan is already in a real Silpo cart. Editing it would
 * desync the two: `cart.materialize` re-reads `list_lines` at write time and never removes,
 * so a re-materialize would add the new dish's SKUs and leave the old ones behind.
 */
const alreadyMaterialized = z.object({
  status: z.literal("already_materialized"),
  reason: z.string(),
});

export const planReplaceItemResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    day: z.number().int().positive(),
    current: planAlternativeSchema.nullable(),
    alternatives: z.array(planAlternativeSchema),
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type PlanReplaceItemResult = z.infer<typeof planReplaceItemResultSchema>;

/** What an applied edit changed — the input to the Guest-facing note. */
export const planChangeSchema = z.object({
  kind: z.enum(["replace_item", "cheaper"]),
  totalBeforeUah: z.number().nonnegative(),
  totalAfterUah: z.number().nonnegative(),
  budgetBeforeUah: z.number().nonnegative(),
  budgetAfterUah: z.number().nonnegative(),
  removedDishes: z.array(z.string()),
  addedDishes: z.array(z.string()),
  changedDays: z.array(z.number().int().positive()),
  promoSharePctBefore: z.number().min(0).max(100),
  promoSharePctAfter: z.number().min(0).max(100),
  /** 2–3 sentences, LLM or deterministic fallback. */
  note: z.string(),
});
export type PlanChange = z.infer<typeof planChangeSchema>;

export const planEditResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), plan: planDetailSchema, change: planChangeSchema }),
  z.object({ status: z.literal("not_found") }),
  alreadyMaterialized,
  /** The requested dish is not a valid substitution (gone, unaffordable, breaks a constraint). */
  z.object({ status: z.literal("rejected"), reason: z.string() }),
  z.object({
    status: z.literal("infeasible"),
    binding: infeasibleBindingSchema,
    reason: z.string(),
    shortfallUah: z.number().nonnegative().optional(),
    nearest: nearestPlanSchema.optional(),
  }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type PlanEditResult = z.infer<typeof planEditResultSchema>;
