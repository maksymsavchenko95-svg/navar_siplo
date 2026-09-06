/**
 * Glue between `@navar/retail`'s MCP trace seam (`runWithMcpTrace`) and `@navar/db`'s
 * `mcp_call_log` (roadmap T4.3, `FR-OPS-001`, `AC-P0-08`). Persisting the trace is
 * best-effort — a failed insert must never fail a plan generation or a cart write.
 */

import type { McpCallPhase } from "@navar/domain";
import { type McpCallScope, saveMcpCalls, toMcpCallRows } from "@navar/db";
import { type McpCallRecord, runWithMcpTrace } from "@navar/retail";

/** Best-effort insert of recorded MCP calls. Swallows and logs any DB error. */
export async function persistMcpTrace(
  records: readonly McpCallRecord[],
  scope: McpCallScope,
): Promise<void> {
  if (records.length === 0) return;
  try {
    await saveMcpCalls(toMcpCallRows(records, scope));
  } catch (err) {
    console.warn("[mcp-trace] persist failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Run `fn` inside an MCP trace scope, then persist the recorded calls under `planId` /
 * `householdId`. Use when the plan id is known up front (the `cart.*` flows, `bootstrap`);
 * `plan.generate` mints its id mid-flight and persists the records itself.
 */
export async function withPersistedMcpTrace<T>(
  phase: McpCallPhase,
  ids: { planId?: string | null; householdId?: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  const { result, records } = await runWithMcpTrace({ phase }, fn);
  await persistMcpTrace(records, { ...ids, phase });
  return result;
}
