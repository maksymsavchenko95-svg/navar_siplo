import { getPlanDetail, listPlans } from "@navar/db";
import {
  type Plan,
  type PlanGenerateResult,
  type PlanGetResult,
  planGenerateInputSchema,
} from "@navar/domain";
import { z } from "zod";

import { generateAndPersistPlan } from "../../plan.js";
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
});
