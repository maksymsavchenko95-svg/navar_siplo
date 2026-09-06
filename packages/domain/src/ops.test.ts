import { describe, expect, it } from "vitest";

import { type McpCall, mcpCallSchema, opsTraceResultSchema, summarizeTrace } from "./ops.js";

const call = (over: Partial<McpCall> = {}): McpCall => ({
  correlationId: "cid-1",
  phase: "plan_generate",
  tool: "silpo_find_products_batch",
  args: { products: ["a"] },
  startedAt: "2026-09-07T10:00:00.000Z",
  durationMs: 100,
  attempts: 1,
  cached: false,
  status: "ok",
  errorCode: null,
  errorMessage: null,
  resultBytes: 20,
  ...over,
});

describe("summarizeTrace", () => {
  it("folds counts, durations, per-tool aggregates and distinct correlation ids", () => {
    const s = summarizeTrace([
      call(),
      call({ tool: "silpo_find_products_batch", durationMs: 50 }),
      call({ tool: "tools/list", status: "error", errorCode: "429", durationMs: 10 }),
      call({ tool: "silpo_get_promotions", cached: true, durationMs: 0, attempts: 0 }),
      call({ correlationId: "cid-2" }),
    ]);

    expect(s).toMatchObject({
      totalCalls: 5,
      okCalls: 4,
      errorCalls: 1,
      cachedCalls: 1,
      totalDurationMs: 260,
      correlationIds: ["cid-1", "cid-2"],
    });
    expect(s.byTool["silpo_find_products_batch"]).toEqual({ count: 3, durationMs: 250 });
    expect(s.byTool["tools/list"]).toEqual({ count: 1, durationMs: 10 });
  });

  it("is empty-safe", () => {
    expect(summarizeTrace([])).toMatchObject({ totalCalls: 0, byTool: {}, correlationIds: [] });
  });
});

describe("schemas", () => {
  it("mcpCallSchema accepts a cache-hit row (attempts 0)", () => {
    expect(() =>
      mcpCallSchema.parse(call({ cached: true, attempts: 0, durationMs: 0 })),
    ).not.toThrow();
  });

  it("opsTraceResultSchema round-trips an ok result", () => {
    const parsed = opsTraceResultSchema.parse({
      status: "ok",
      planId: "11111111-1111-4111-8111-111111111111",
      calls: [call()],
      summary: summarizeTrace([call()]),
    });
    expect(parsed.status).toBe("ok");
  });
});
