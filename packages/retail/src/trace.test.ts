import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  currentTraceScope,
  type McpCallEvent,
  recordCacheHit,
  recordMcpCall,
  runWithMcpTrace,
  summarizeArgs,
} from "./trace.js";

const ev = (over: Partial<McpCallEvent> = {}): McpCallEvent => ({
  tool: "silpo_find_products_batch",
  args: { items: ["a"] },
  startedAt: "2026-09-07T10:00:00.000Z",
  durationMs: 12,
  attempts: 1,
  status: "ok",
  resultBytes: 42,
  ...over,
});

describe("runWithMcpTrace", () => {
  beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("collects records made inside the scope and mints a correlation id", async () => {
    const { records, correlationId } = await runWithMcpTrace(
      { phase: "plan_generate" },
      async () => {
        recordMcpCall(ev({ tool: "tools/list" }));
        recordMcpCall(ev({ tool: "silpo_get_my_shopping_cart" }));
        return "done";
      },
    );

    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(records.map((r) => r.tool)).toEqual(["tools/list", "silpo_get_my_shopping_cart"]);
    expect(records.every((r) => r.correlationId === correlationId)).toBe(true);
    expect(records.every((r) => r.phase === "plan_generate")).toBe(true);
  });

  it("honours a supplied correlation id", async () => {
    const { correlationId } = await runWithMcpTrace(
      { phase: "cart_materialize", correlationId: "fixed-cid" },
      async () => {},
    );
    expect(correlationId).toBe("fixed-cid");
  });

  it("isolates concurrent scopes across interleaved awaits", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const a = runWithMcpTrace({ phase: "plan_generate" }, async () => {
      recordMcpCall(ev({ tool: "a1" }));
      await tick();
      recordMcpCall(ev({ tool: "a2" }));
    });
    const b = runWithMcpTrace({ phase: "cart_preview" }, async () => {
      await tick();
      recordMcpCall(ev({ tool: "b1" }));
    });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.records.map((r) => r.tool)).toEqual(["a1", "a2"]);
    expect(rb.records.map((r) => r.tool)).toEqual(["b1"]);
    expect(ra.correlationId).not.toBe(rb.correlationId);
  });

  it("outside a scope, records are only logged, not buffered", () => {
    expect(currentTraceScope()).toBeUndefined();
    recordMcpCall(ev());
    expect(console.info).toHaveBeenCalledOnce();
  });

  it("records error details", async () => {
    const { records } = await runWithMcpTrace({ phase: "bootstrap" }, async () => {
      recordMcpCall(
        ev({ status: "error", errorCode: "429", errorMessage: "Rate limit", resultBytes: null }),
      );
    });
    expect(records[0]).toMatchObject({ status: "error", errorCode: "429", resultBytes: null });
  });

  it("recordCacheHit marks a zero-attempt cached entry", async () => {
    const { records } = await runWithMcpTrace({ phase: "plan_generate" }, async () => {
      recordCacheHit("silpo_get_promotions", { branchId: "b1" }, 100);
    });
    expect(records[0]).toMatchObject({
      tool: "silpo_get_promotions",
      cached: true,
      attempts: 0,
      durationMs: 0,
      status: "ok",
    });
  });
});

describe("summarizeArgs", () => {
  it("redacts PII keys", () => {
    expect(summarizeArgs({ phone: "+380...", productId: "p1" })).toEqual({
      phone: "«redacted»",
      productId: "p1",
    });
  });

  it("truncates long strings and large arrays", () => {
    const out = summarizeArgs({
      q: "x".repeat(500),
      items: Array.from({ length: 30 }, (_, i) => i),
    });
    expect((out as { q: string }).q).toHaveLength(201); // 200 + ellipsis
    const items = (out as { items: unknown[] }).items;
    expect(items).toHaveLength(21);
    expect(items[20]).toBe("…+10 more");
  });
});
