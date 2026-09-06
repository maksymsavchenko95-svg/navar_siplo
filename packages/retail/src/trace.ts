/**
 * MCP call trace seam (roadmap T4.3, `FR-OPS-001`, `AC-P0-08`, `.claude/rules/mcp-integration.md`
 * "Observability"). Every JSON-RPC call `SilpoRetailProvider` makes is recorded — tool,
 * duration, status, correlation id — so the demo can *show* the calls happening and
 * `ops.trace(planId)` can read them back.
 *
 * Scope-based, not a constructor-injected tracer: the provider is per-household and shared
 * across concurrent requests, so a mutable "current correlation id" field would race.
 * `AsyncLocalStorage` scopes a batch of calls to one unit of work (`plan.generate`, a
 * `cart.*` call, a bootstrap) without threading a parameter through every `callTool` caller.
 *
 * Mirror of `@navar/llm`'s `LlmTracer`. PII discipline: `args` is a redacted, truncated
 * summary of the *request* arguments; the response body is never recorded (the household
 * reads return names / addresses — `INT-LLM-004`).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { type McpCall, type McpCallPhase, redact } from "@navar/domain";

export type McpCallRecord = McpCall;

/** The fields the adapter supplies per call; `correlationId` / `phase` come from the scope. */
export interface McpCallEvent {
  tool: string;
  args: unknown;
  startedAt: string;
  durationMs: number;
  attempts: number;
  status: "ok" | "error";
  cached?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  resultBytes?: number | null;
}

interface TraceScope {
  correlationId: string;
  phase: McpCallPhase;
  records: McpCallRecord[];
}

const store = new AsyncLocalStorage<TraceScope>();

/** The active trace scope, if any. Exposed for tests. */
export function currentTraceScope(): { correlationId: string; phase: McpCallPhase } | undefined {
  const s = store.getStore();
  return s ? { correlationId: s.correlationId, phase: s.phase } : undefined;
}

const MAX_STRING = 200;
const MAX_ARRAY = 20;

/** Redact PII, then bound the size of an argument summary so a trace row stays small. */
export function summarizeArgs(args: unknown): unknown {
  const trunc = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
    if (Array.isArray(v)) {
      const head = v.slice(0, MAX_ARRAY).map(trunc);
      return v.length > MAX_ARRAY ? [...head, `…+${v.length - MAX_ARRAY} more`] : head;
    }
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, trunc(x)]),
      );
    }
    return v;
  };
  return trunc(redact(args));
}

/**
 * Record one logical MCP call. Always logs a single structured `[mcp]` line (the
 * `FR-OPS-001` baseline — every call is logged, scope or not); additionally appends to the
 * active trace scope's buffer when one is open.
 */
export function recordMcpCall(ev: McpCallEvent): void {
  const scope = store.getStore();
  const rec: McpCallRecord = {
    correlationId: scope?.correlationId ?? "-",
    phase: scope?.phase ?? "other",
    tool: ev.tool,
    args: summarizeArgs(ev.args),
    startedAt: ev.startedAt,
    durationMs: ev.durationMs,
    attempts: ev.attempts,
    cached: ev.cached ?? false,
    status: ev.status,
    errorCode: ev.errorCode ?? null,
    errorMessage: ev.errorMessage != null ? String(ev.errorMessage).slice(0, 500) : null,
    resultBytes: ev.resultBytes ?? null,
  };
  scope?.records.push(rec);

  const tag = rec.cached
    ? "cached"
    : rec.status === "ok"
      ? "ok"
      : `error${rec.errorCode ? ` ${rec.errorCode}` : ""}`;
  // eslint-disable-next-line no-console
  console.info(
    `[mcp] ${rec.tool} ${rec.durationMs}ms ${tag}` +
      (rec.attempts > 1 ? ` (${rec.attempts} attempts)` : "") +
      ` cid=${rec.correlationId} phase=${rec.phase}`,
  );
}

/**
 * Record that a value was served from the provider's short-lived cache — no JSON-RPC call
 * left the process. Keeps `ops.trace` honest about *what the agent needed* even when the
 * long-lived per-household provider answers from cache (a second plan within the price TTL).
 */
export function recordCacheHit(tool: string, args: unknown, resultBytes?: number | null): void {
  recordMcpCall({
    tool,
    args,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    attempts: 0,
    cached: true,
    status: "ok",
    resultBytes: resultBytes ?? null,
  });
}

/**
 * Run `fn` inside a fresh trace scope. Every MCP call made during `fn` (on any provider,
 * on any awaited path) is collected into `records` and tagged with `correlationId` + `phase`.
 * A new correlation id is minted unless one is supplied (e.g. to correlate with an upstream
 * request id).
 */
export async function runWithMcpTrace<T>(
  opts: { phase: McpCallPhase; correlationId?: string },
  fn: () => Promise<T>,
): Promise<{ result: T; correlationId: string; records: McpCallRecord[] }> {
  const scope: TraceScope = {
    correlationId: opts.correlationId ?? randomUUID(),
    phase: opts.phase,
    records: [],
  };
  const result = await store.run(scope, fn);
  return { result, correlationId: scope.correlationId, records: scope.records };
}
