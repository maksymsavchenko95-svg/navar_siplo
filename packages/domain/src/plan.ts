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
  costUah: z.number().nonnegative(),
  promoShareUah: z.number().nonnegative(),
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
  price: z.number().nullable(),
  oldPrice: z.number().nullable(),
  isPromo: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  decision: skuMatchDecisionSchema.nullable(),
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
  estimatedCostUah: z.number().nonnegative().nullable(),
  unpricedLineCount: z.number().int().nonnegative(),
  proteinFloorMet: z.boolean().nullable(),
  kcalCorridorMet: z.boolean().nullable(),
  explanation: z.string().nullable(),
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
