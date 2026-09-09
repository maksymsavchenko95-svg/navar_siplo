import { z } from "zod";

/**
 * Observability contracts (roadmap T4.3, `FR-OPS-001`, `AC-P0-08`). Every MCP call the
 * agent makes is recorded — tool, duration, status, correlation id — and `ops.trace(planId)`
 * reads the recorded calls back for the demo, with a summary. The recording seam itself
 * lives in `@navar/retail` (`trace.ts`); this is the *stored + returned* shape.
 *
 * PII-free by construction: `args` is a redacted summary of the outbound arguments (slugs,
 * product ids, branch ids, query strings) and the response body is never stored — the
 * household reads (`silpo_get_my_*`) return names / addresses.
 */

export const mcpCallPhaseSchema = z.enum([
  "plan_generate",
  "cart_preview",
  "cart_materialize",
  "cart_checkout_link",
  "cart_bonus",
  "cart_line_alternatives",
  "cart_set_line_sku",
  "bootstrap",
  "other",
]);
export type McpCallPhase = z.infer<typeof mcpCallPhaseSchema>;

export const mcpCallStatusSchema = z.enum(["ok", "error"]);
export type McpCallStatus = z.infer<typeof mcpCallStatusSchema>;

/** One recorded JSON-RPC MCP call (a `mcp_call_log` row, read back). */
export const mcpCallSchema = z.object({
  correlationId: z.string(),
  phase: mcpCallPhaseSchema,
  tool: z.string(),
  /** Redacted, truncated summary of the request arguments — never the response body. */
  args: z.unknown(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  /** How many transport attempts the logical call took (retries fold in); `0` = cache hit. */
  attempts: z.number().int().nonnegative(),
  /** Served from the provider's short-lived cache — no JSON-RPC call actually left. */
  cached: z.boolean(),
  status: mcpCallStatusSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** Size of the parsed response payload in bytes; `null` on error. */
  resultBytes: z.number().int().nonnegative().nullable(),
});
export type McpCall = z.infer<typeof mcpCallSchema>;

export const opsTraceSummarySchema = z.object({
  totalCalls: z.number().int().nonnegative(),
  okCalls: z.number().int().nonnegative(),
  errorCalls: z.number().int().nonnegative(),
  /** Of `totalCalls`, how many were served from cache (no JSON-RPC round trip). */
  cachedCalls: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  byTool: z.record(
    z.string(),
    z.object({ count: z.number().int().positive(), durationMs: z.number().int().nonnegative() }),
  ),
  correlationIds: z.array(z.string()),
});
export type OpsTraceSummary = z.infer<typeof opsTraceSummarySchema>;

export const opsTraceResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    planId: z.string().uuid(),
    calls: z.array(mcpCallSchema),
    summary: opsTraceSummarySchema,
  }),
  z.object({ status: z.literal("not_found") }),
]);
export type OpsTraceResult = z.infer<typeof opsTraceResultSchema>;

/** `ops.bootstrapTrace` — the household's latest `household.bootstrap` MCP calls (no plan id). */
export const opsBootstrapTraceResultSchema = z.object({
  status: z.literal("ok"),
  calls: z.array(mcpCallSchema),
  summary: opsTraceSummarySchema,
});
export type OpsBootstrapTraceResult = z.infer<typeof opsBootstrapTraceResultSchema>;

/** Fold a list of recorded calls into the `ops.trace` summary. Pure. */
export function summarizeTrace(calls: readonly McpCall[]): OpsTraceSummary {
  const byTool: Record<string, { count: number; durationMs: number }> = {};
  const correlationIds: string[] = [];
  let okCalls = 0;
  let errorCalls = 0;
  let cachedCalls = 0;
  let totalDurationMs = 0;

  for (const c of calls) {
    const t = (byTool[c.tool] ??= { count: 0, durationMs: 0 });
    t.count += 1;
    t.durationMs += c.durationMs;
    totalDurationMs += c.durationMs;
    if (c.status === "ok") okCalls += 1;
    else errorCalls += 1;
    if (c.cached) cachedCalls += 1;
    if (!correlationIds.includes(c.correlationId)) correlationIds.push(c.correlationId);
  }

  return {
    totalCalls: calls.length,
    okCalls,
    errorCalls,
    cachedCalls,
    totalDurationMs,
    byTool,
    correlationIds,
  };
}
