import { deletePlan, getPlanDetail, getPlanRecipe, listPlans } from "@navar/db";
import {
  type Plan,
  type PlanDeleteResult,
  type PlanEditResult,
  type PlanGenerateResult,
  type PlanGenerationStageResult,
  type PlanGetResult,
  type PlanRecipeResult,
  type PlanReplaceItemResult,
  planGenerateInputSchema,
} from "@navar/domain";
import { z } from "zod";

import { applyReplacement, makeCheaper, proposeReplacements } from "../../plan-edit.js";
import { generateAndPersistPlan, toPlanRecipeView } from "../../plan.js";
import { readGenStage } from "../../plan-progress.js";
import { protectedProcedure, router } from "../trpc.js";

/**
 * `plan.*` (roadmap T2.4 / T2.6, TDD §7). `generate` runs the deterministic solver
 * (`@navar/planner`) over the household's corpus + live Silpo prices, persists a feasible
 * plan + its shopping list, attaches the `explainPlan` note, and returns `{ planId }`.
 * `get` reads a saved plan (`NFR-PERF-001` — p95 < 400 ms). Synchronous in P0; background
 * generation with progress stages is T4.5.
 */
export const planRouter = router({
  generate: protectedProcedure
    .input(planGenerateInputSchema.optional())
    .mutation(async ({ ctx, input }): Promise<PlanGenerateResult> => {
      try {
        return await generateAndPersistPlan(ctx.householdId, ctx.retail, input ?? {});
      } catch (err) {
        return { status: "error", message: err instanceof Error ? err.message : String(err) };
      }
    }),

  get: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<PlanGetResult> => {
      const plan = await getPlanDetail(input.planId, ctx.householdId);
      return plan ? { status: "ok", plan } : { status: "not_found" };
    }),

  list: protectedProcedure.query(async ({ ctx }): Promise<Plan[]> => {
    return listPlans(ctx.householdId);
  }),

  /**
   * `plan.generationStage` (T4.5) — the current pipeline stage of an in-flight
   * `plan.generate` for this household, or `null` when none is running. The generate screen
   * polls this so the progress card shows real stages, not `Math.floor(elapsed / 6)`.
   */
  generationStage: protectedProcedure.query(async ({ ctx }): Promise<PlanGenerationStageResult> => {
    return { stage: await readGenStage(ctx.householdId) };
  }),

  /**
   * `plan.delete` (R8) — hard-delete a plan and its items / list / MCP-call log (cascade),
   * scoped to the session household. Deliberately does **not** touch the Silpo cart of a
   * materialized plan (`FR-CART-004`); the Guest clears that in Silpo if they want.
   */
  delete: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .mutation(async ({ ctx, input }): Promise<PlanDeleteResult> => {
      const n = await deletePlan(input.planId, ctx.householdId);
      return n > 0 ? { status: "ok" } : { status: "not_found" };
    }),

  /**
   * `R2` — one saved dinner as a cooking recipe: steps + ingredient amounts scaled to the
   * household (`servings / recipe.servings × portionScale`). A pure DB read, no MCP/LLM —
   * the screen the Guest lives in for the week, so it works for materialized plans too.
   */
  recipe: protectedProcedure
    .input(z.object({ planId: z.string().uuid(), day: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<PlanRecipeResult> => {
      return toPlanRecipeView(await getPlanRecipe(input.planId, ctx.householdId, input.day));
    }),

  /**
   * `FR-PLAN-007` — three alternatives for one day. A query: it writes nothing, so the Guest
   * can look before committing (`applyReplacement` is the commit).
   */
  replaceItem: protectedProcedure
    .input(z.object({ planId: z.string().uuid(), day: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<PlanReplaceItemResult> => {
      return proposeReplacements(input.planId, ctx.householdId, input.day, ctx.retail);
    }),

  applyReplacement: protectedProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        day: z.number().int().positive(),
        recipeId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<PlanEditResult> => {
      return applyReplacement(input.planId, ctx.householdId, input.day, input.recipeId, ctx.retail);
    }),

  /** `FR-PLAN-008` — rebuild the plan `deltaUah` cheaper, explaining what changed. */
  cheaper: protectedProcedure
    .input(z.object({ planId: z.string().uuid(), deltaUah: z.number().positive() }))
    .mutation(async ({ ctx, input }): Promise<PlanEditResult> => {
      return makeCheaper(input.planId, ctx.householdId, input.deltaUah, ctx.retail);
    }),
});
