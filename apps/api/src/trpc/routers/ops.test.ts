import type { McpCall } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

// ── mock @navar/db so this is a pure wiring test ────────────────────────────

const getMcpCallsByPlan = vi.fn<() => Promise<McpCall[] | null>>();
const getBootstrapMcpCalls = vi.fn<() => Promise<McpCall[]>>();

vi.mock("@navar/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@navar/db")>()),
  getMcpCallsByPlan: (...a: unknown[]) => getMcpCallsByPlan(...(a as [])),
  getBootstrapMcpCalls: (...a: unknown[]) => getBootstrapMcpCalls(...(a as [])),
}));

const { appRouter } = await import("../router.js");
const { testContext } = await import("../test-context.js");

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const ctx = () => testContext({ householdId: "hh-1", retail: {} as never });

const call = (over: Partial<McpCall> = {}): McpCall => ({
  correlationId: "cid-1",
  phase: "plan_generate",
  tool: "silpo_find_products_batch",
  args: null,
  startedAt: "2026-09-07T10:00:00.000Z",
  durationMs: 100,
  attempts: 1,
  cached: false,
  status: "ok",
  errorCode: null,
  errorMessage: null,
  resultBytes: 10,
  ...over,
});

describe("ops router", () => {
  it("returns the scoped calls + a summary", async () => {
    getMcpCallsByPlan.mockResolvedValueOnce([
      call(),
      call({ tool: "tools/list", durationMs: 50, status: "error", errorCode: "429" }),
    ]);

    const res = await appRouter.createCaller(ctx()).ops.trace({ planId: PLAN_ID });

    expect(getMcpCallsByPlan).toHaveBeenCalledWith(PLAN_ID, "hh-1");
    expect(res).toMatchObject({
      status: "ok",
      planId: PLAN_ID,
      summary: {
        totalCalls: 2,
        okCalls: 1,
        errorCalls: 1,
        cachedCalls: 0,
        totalDurationMs: 150,
        correlationIds: ["cid-1"],
      },
    });
  });

  it("maps a missing / cross-household plan to not_found", async () => {
    getMcpCallsByPlan.mockResolvedValueOnce(null);
    const res = await appRouter.createCaller(ctx()).ops.trace({ planId: PLAN_ID });
    expect(res).toEqual({ status: "not_found" });
  });

  it("is protected — no session → UNAUTHORIZED", async () => {
    const anon = testContext({ householdId: null });
    await expect(appRouter.createCaller(anon).ops.trace({ planId: PLAN_ID })).rejects.toThrow(
      /UNAUTHORIZED|Not connected/,
    );
  });

  it("bootstrapTrace returns the household's bootstrap calls + a summary (B5)", async () => {
    getBootstrapMcpCalls.mockResolvedValueOnce([
      call({ phase: "bootstrap", tool: "silpo_get_my_profile" }),
      call({ phase: "bootstrap", tool: "silpo_get_my_orders", durationMs: 40 }),
    ]);
    const res = await appRouter.createCaller(ctx()).ops.bootstrapTrace();
    expect(getBootstrapMcpCalls).toHaveBeenCalledWith("hh-1");
    expect(res).toMatchObject({
      status: "ok",
      summary: { totalCalls: 2, okCalls: 2, totalDurationMs: 140 },
    });
    expect(res).not.toHaveProperty("planId");
  });
});
