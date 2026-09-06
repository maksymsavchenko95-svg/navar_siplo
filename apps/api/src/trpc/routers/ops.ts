import { getMcpCallsByPlan } from "@navar/db";
import { type OpsTraceResult, summarizeTrace } from "@navar/domain";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc.js";

/**
 * `ops.*` (roadmap T4.3, TDD §7, `FR-OPS-001`, `AC-P0-08`). `trace(planId)` returns the
 * recorded JSON-RPC MCP calls that built and materialised a plan — tool, duration, status,
 * correlation id — plus a summary, so the demo can *show* the agent talking to Silpo. The
 * `mcp_call_log` rows are written best-effort by `apps/api/src/mcp-trace.ts`.
 */
export const opsRouter = router({
  trace: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<OpsTraceResult> => {
      const calls = await getMcpCallsByPlan(input.planId, ctx.householdId);
      if (calls == null) return { status: "not_found" };
      return { status: "ok", planId: input.planId, calls, summary: summarizeTrace(calls) };
    }),
});
