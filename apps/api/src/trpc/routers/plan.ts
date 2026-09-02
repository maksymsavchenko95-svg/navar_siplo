import { getPlanDetail, listPlans } from "@navar/db";
import {
  type Plan,
  type PlanGenerateResult,
  type PlanGetResult,
  planGenerateInputSchema,
} from "@navar/domain";
import { z } from "zod";

import { resolveHouseholdId } from "../../household.js";
import { generateAndPersistPlan } from "../../plan.js";
import { publicProcedure, router } from "../trpc.js";

/**
 * `plan.*` (roadmap T2.4 / T2.6, TDD §7). `generate` runs the deterministic solver
 * (`@navar/planner`) over the household's corpus + live Silpo prices, persists a feasible
 * plan + its shopping list, attaches the `explainPlan` note, and returns `{ planId }`.
 * `get` reads a saved plan (`NFR-PERF-001` — p95 < 400 ms). Synchronous in P0; background
 * generation with progress stages is T4.5.
 */
export const planRouter = router({
  generate: publicProcedure
    .input(planGenerateInputSchema.optional())
    .mutation(async ({ ctx, input }): Promise<PlanGenerateResult> => {
      const householdId = await resolveHouseholdId();
      if (!householdId) return { status: "error", message: "no household — run pnpm db:seed" };
      try {
        return await generateAndPersistPlan(householdId, ctx.retail, input ?? {});
      } catch (err) {
        return { status: "error", message: err instanceof Error ? err.message : String(err) };
      }
    }),

  get: publicProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ input }): Promise<PlanGetResult> => {
      const householdId = await resolveHouseholdId();
      if (!householdId) return { status: "not_found" };
      const plan = await getPlanDetail(input.planId, householdId);
      return plan ? { status: "ok", plan } : { status: "not_found" };
    }),

  list: publicProcedure.query(async (): Promise<Plan[]> => {
    const householdId = await resolveHouseholdId();
    if (!householdId) return [];
    return listPlans(householdId);
  }),
});
