/**
 * Persist + read back the MCP call trace (roadmap T4.3, `FR-OPS-001`, `AC-P0-08`). The
 * recording seam is `@navar/retail`'s `trace.ts`; this is the only file that touches the
 * `mcp_call_log` table.
 *
 * `toMcpCallRows` is a pure mapper (`McpCall[]` → insert rows) split from the DB I/O so it
 * unit-tests without a database — the `toPlanRows` / `receipt-lines.ts` pattern. Writes are
 * best-effort at the call sites: a failed trace insert must never fail a plan or a cart write.
 */

import type { McpCall, McpCallPhase } from "@navar/domain";
import { and, asc, eq } from "drizzle-orm";

import { db, type Db } from "./client.js";
import { mcpCallLog, plans } from "./schema.js";

export type NewMcpCallRow = typeof mcpCallLog.$inferInsert;

export interface McpCallScope {
  /** Set for plan-scoped flows (`plan.generate`, `cart.*`); null for `bootstrap`. */
  planId?: string | null;
  householdId?: string | null;
  phase: McpCallPhase;
}

/** `McpCall[]` (from a `runWithMcpTrace` scope) → `mcp_call_log` insert rows. Pure. */
export function toMcpCallRows(calls: readonly McpCall[], scope: McpCallScope): NewMcpCallRow[] {
  return calls.map((c) => ({
    correlationId: c.correlationId,
    householdId: scope.householdId ?? null,
    planId: scope.planId ?? null,
    phase: scope.phase,
    tool: c.tool,
    args: (c.args ?? null) as NewMcpCallRow["args"],
    startedAt: new Date(c.startedAt),
    durationMs: Math.round(c.durationMs),
    attempts: c.attempts,
    cached: c.cached,
    status: c.status,
    errorCode: c.errorCode,
    errorMessage: c.errorMessage,
    resultBytes: c.resultBytes,
  }));
}

/** Insert recorded MCP calls. No-op on an empty list. */
export async function saveMcpCalls(
  rows: readonly NewMcpCallRow[],
  database: Db = db,
): Promise<void> {
  if (rows.length === 0) return;
  await database.insert(mcpCallLog).values(rows as NewMcpCallRow[]);
}

/** A `mcp_call_log` row → the `McpCall` domain shape. */
function toMcpCall(row: typeof mcpCallLog.$inferSelect): McpCall {
  return {
    correlationId: row.correlationId,
    phase: row.phase as McpCallPhase,
    tool: row.tool,
    args: row.args ?? null,
    startedAt: row.startedAt.toISOString(),
    durationMs: row.durationMs,
    attempts: row.attempts,
    cached: row.cached,
    status: row.status as McpCall["status"],
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    resultBytes: row.resultBytes,
  };
}

/**
 * The recorded MCP calls for one plan, oldest first. **Household-scoped** — the plan id
 * alone is not an authorisation (mirrors `getPlanDetail` / `updatePlanDay`). Returns `null`
 * when the plan does not exist or belongs to another household, `[]` when it simply has no
 * trace yet.
 */
export async function getMcpCallsByPlan(
  planId: string,
  householdId: string,
  database: Db = db,
): Promise<McpCall[] | null> {
  const owned = await database
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.householdId, householdId)));
  if (owned.length === 0) return null;

  const rows = await database
    .select()
    .from(mcpCallLog)
    .where(eq(mcpCallLog.planId, planId))
    .orderBy(asc(mcpCallLog.startedAt), asc(mcpCallLog.id));
  return rows.map(toMcpCall);
}
