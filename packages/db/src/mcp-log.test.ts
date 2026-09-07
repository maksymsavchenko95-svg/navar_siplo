import type { McpCall } from "@navar/domain";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "./client.js";
import { getBootstrapMcpCalls, getMcpCallsByPlan, saveMcpCalls, toMcpCallRows } from "./mcp-log.js";
import { households, plans } from "./schema.js";

const call = (over: Partial<McpCall> = {}): McpCall => ({
  correlationId: "cid-1",
  phase: "plan_generate",
  tool: "silpo_find_products_batch",
  args: { items: ["a", "b"] },
  startedAt: "2026-09-07T10:00:00.000Z",
  durationMs: 120,
  attempts: 1,
  cached: false,
  status: "ok",
  errorCode: null,
  errorMessage: null,
  resultBytes: 512,
  ...over,
});

// ─── pure ────────────────────────────────────────────────────────────────────

describe("toMcpCallRows", () => {
  it("maps domain calls to insert rows with the scope stamped on", () => {
    const rows = toMcpCallRows(
      [call(), call({ tool: "tools/list", status: "error", errorCode: "429" })],
      {
        planId: "plan-1",
        householdId: "hh-1",
        phase: "plan_generate",
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      planId: "plan-1",
      householdId: "hh-1",
      phase: "plan_generate",
      tool: "silpo_find_products_batch",
      durationMs: 120,
      status: "ok",
    });
    expect(rows[0]!.startedAt).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ tool: "tools/list", status: "error", errorCode: "429" });
  });

  it("allows a null planId (bootstrap scope)", () => {
    const [row] = toMcpCallRows([call({ phase: "bootstrap" })], {
      householdId: "hh-1",
      phase: "bootstrap",
    });
    expect(row!.planId).toBeNull();
    expect(row!.householdId).toBe("hh-1");
  });
});

// ─── integration ─────────────────────────────────────────────────────────────

describe.skipIf(!process.env.DATABASE_URL)("saveMcpCalls / getMcpCallsByPlan (integration)", () => {
  const madeHouseholds: string[] = [];

  afterEach(async () => {
    for (const id of madeHouseholds.splice(0)) {
      await db.delete(households).where(eq(households.id, id));
    }
  });
  afterAll(closeDb);

  async function makePlan() {
    const [hh] = await db.insert(households).values({ goal: "routine" }).returning();
    madeHouseholds.push(hh!.id);
    const [plan] = await db
      .insert(plans)
      .values({ householdId: hh!.id, goal: "routine", seed: 1, days: 5, budgetUah: "1000.00" })
      .returning();
    return { householdId: hh!.id, planId: plan!.id };
  }

  it("round-trips a trace ordered by start time, scoped to the owning household", async () => {
    const { householdId, planId } = await makePlan();
    await saveMcpCalls(
      toMcpCallRows(
        [
          call({ tool: "tools/list", startedAt: "2026-09-07T10:00:02.000Z" }),
          call({ tool: "silpo_get_my_shopping_cart", startedAt: "2026-09-07T10:00:01.000Z" }),
        ],
        { planId, householdId, phase: "plan_generate" },
      ),
    );

    const calls = await getMcpCallsByPlan(planId, householdId);
    expect(calls?.map((c) => c.tool)).toEqual(["silpo_get_my_shopping_cart", "tools/list"]);

    const { householdId: other } = await makePlan();
    expect(await getMcpCallsByPlan(planId, other)).toBeNull();
  });

  it("returns null for an unknown plan and [] for one with no trace", async () => {
    const { householdId, planId } = await makePlan();
    expect(await getMcpCallsByPlan(planId, householdId)).toEqual([]);
    expect(await getMcpCallsByPlan("00000000-0000-0000-0000-000000000000", householdId)).toBeNull();
  });

  it("saveMcpCalls is a no-op on an empty list", async () => {
    await expect(saveMcpCalls([])).resolves.toBeUndefined();
  });

  it("getBootstrapMcpCalls returns only the household's latest bootstrap run (T4.4 B5)", async () => {
    const [hh] = await db.insert(households).values({ goal: "routine" }).returning();
    madeHouseholds.push(hh!.id);

    // an older bootstrap run + a plan-phase call (must be excluded) + the newest run
    await saveMcpCalls(
      toMcpCallRows(
        [
          call({ correlationId: "boot-old", startedAt: "2026-09-07T09:00:00.000Z" }),
          call({ correlationId: "boot-old", startedAt: "2026-09-07T09:00:01.000Z" }),
        ],
        { householdId: hh!.id, phase: "bootstrap" },
      ),
    );
    await saveMcpCalls(
      toMcpCallRows([call({ correlationId: "plan", startedAt: "2026-09-07T09:30:00.000Z" })], {
        householdId: hh!.id,
        phase: "plan_generate",
      }),
    );
    await saveMcpCalls(
      toMcpCallRows(
        [
          call({ correlationId: "boot-new", startedAt: "2026-09-07T10:00:00.000Z" }),
          call({ correlationId: "boot-new", startedAt: "2026-09-07T10:00:02.000Z" }),
          call({ correlationId: "boot-new", startedAt: "2026-09-07T10:00:01.000Z" }),
        ],
        { householdId: hh!.id, phase: "bootstrap" },
      ),
    );

    const calls = await getBootstrapMcpCalls(hh!.id);
    expect(calls.map((c) => c.correlationId)).toEqual(["boot-new", "boot-new", "boot-new"]);
    expect(calls.map((c) => c.startedAt)).toEqual([
      "2026-09-07T10:00:00.000Z",
      "2026-09-07T10:00:01.000Z",
      "2026-09-07T10:00:02.000Z",
    ]);
    expect(await getBootstrapMcpCalls("00000000-0000-0000-0000-000000000000")).toEqual([]);
  });
});
