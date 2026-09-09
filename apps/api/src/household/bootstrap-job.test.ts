import { db, schema } from "@navar/db";
import type {
  McpToolsResult,
  RawRestriction,
  RetailFamily,
  RetailOrder,
  RetailProfile,
} from "@navar/domain";
import { LlmUnavailableError, noopTracer } from "@navar/llm";
import { NoCartError } from "@navar/retail";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { type BootstrapReader, REQUIRED_TOOLS, runBootstrap } from "./bootstrap-job.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);

const okTools: McpToolsResult = {
  status: "ok",
  tools: REQUIRED_TOOLS.map((name) => ({ name, description: null })),
};

const PROFILE: RetailProfile = { silpoProfileId: "prof-test", gender: "male", birthYear: 1990 };
const FAMILY: RetailFamily = {
  adultCount: 2,
  childAgeYears: [7],
  petCount: 1,
  itsMeProfileId: "prof-test",
};

function order(createdAt: string, total: number): RetailOrder {
  return {
    source: "online",
    externalId: createdAt,
    createdAt,
    total,
    discount: 0,
    lines: [
      {
        key: "milk",
        name: "Молоко «Галичина»",
        slug: "milk",
        unitPrice: 40,
        quantity: 1,
        lineTotal: 40,
        unit: "l",
        catalogProductId: null,
      },
      {
        key: "bread",
        name: "Хліб",
        slug: "bread",
        unitPrice: 25,
        quantity: 1,
        lineTotal: 25,
        unit: null,
        catalogProductId: null,
      },
    ],
  };
}

function fakeReader(over: Partial<BootstrapReader> = {}): BootstrapReader {
  return {
    listTools: async () => okTools,
    getCartContext: async () => ({
      branchId: "b1",
      deliveryType: "DeliveryHome",
      timeslot: { start: "s", end: "e", minOrderCost: null },
    }),
    getProfile: async () => PROFILE,
    getFamily: async () => FAMILY,
    getFoodRestrictions: async (): Promise<RawRestriction[]> => [
      { slug: "no-milk", text: "алергія на молоко" },
    ],
    getDeliveryAddresses: async () => [{ id: "a", tag: null, city: "Київ" }],
    getOnlineOrders: async () => [
      order("2026-07-06T10:00:00Z", 500),
      order("2026-07-20T10:00:00Z", 600),
      order("2026-08-17T10:00:00Z", 400),
    ],
    getOfflineOrders: async () => [],
    getFavorites: async () => [],
    ...over,
  };
}

const failLlm = { generateObject: async () => Promise.reject(new LlmUnavailableError()) } as never;

const deps = (reader: BootstrapReader) => ({
  reader,
  llm: failLlm, // exercise the deterministic fallbacks offline
  tracer: noopTracer,
  db,
  now: () => new Date("2026-09-02T00:00:00Z"),
});

describe.skipIf(!HAS_DB)("runBootstrap (integration)", () => {
  let householdId: string;

  beforeEach(async () => {
    const [hh] = await db.insert(schema.households).values({ goal: "routine" }).returning();
    householdId = hh!.id;
  });
  afterEach(async () => {
    await db.delete(schema.households).where(eq(schema.households.id, householdId));
  });
  afterAll(async () => {
    await db.$client.end?.();
  });

  async function readBack() {
    const hh = await db.query.households.findFirst({
      where: (h, { eq: e }) => e(h.id, householdId),
      with: { members: true, restrictions: true, consumptionModel: true, preferences: true },
    });
    return hh!;
  }

  it("happy path: writes members, restrictions, model, preferences; status done", async () => {
    const res = await runBootstrap(householdId, deps(fakeReader()));
    expect(res).toEqual({ outcome: "done", orderCount: 3 });

    const hh = await readBack();
    expect(hh.bootstrapStatus).toBe("done");
    expect(hh.silpoUserRef).toBe("prof-test");
    expect(hh.members.map((m) => m.kind).sort()).toEqual(["adult", "adult", "child", "pet"]);
    expect(hh.members.find((m) => m.kind === "child")!.ageYears).toBe(7);
    expect(hh.restrictions.some((r) => r.kind === "allergen" && r.code === "milk")).toBe(true);
    expect(hh.consumptionModel!.source).toBe("receipts");
    expect(hh.consumptionModel!.orderCount).toBe(3);
    expect(Number(hh.consumptionModel!.medianWeeklyChequeUah)).toBeGreaterThan(0);
    expect(hh.preferences!.source).toBe("inferred");
    // budget defaulted to the median (was null)
    expect(hh.weeklyBudget).not.toBeNull();

    // T1.6 — the raw purchased lines are retained (3 fake orders × 2 lines).
    const lines = await db
      .select()
      .from(schema.receiptLines)
      .where(eq(schema.receiptLines.householdId, householdId));
    expect(lines).toHaveLength(6);
    expect(lines.every((l) => l.rawName.length > 0 && l.purchasedAt instanceof Date)).toBe(true);
  });

  it("<3 orders → onboarding_required, no receipts model", async () => {
    const reader = fakeReader({
      getOnlineOrders: async () => [order("2026-08-01T10:00:00Z", 100)],
    });
    const res = await runBootstrap(householdId, deps(reader));
    expect(res).toEqual({ outcome: "onboarding_required", orderCount: 1 });

    const hh = await readBack();
    expect(hh.bootstrapStatus).toBe("onboarding_required");
    expect(hh.consumptionModel!.source).toBe("onboarding");
    expect(hh.consumptionModel!.orderCount).toBe(1);
  });

  it("listTools not ok → auth_required, no household writes", async () => {
    const reader = fakeReader({ listTools: async () => ({ status: "auth_required", hint: "x" }) });
    const res = await runBootstrap(householdId, deps(reader));
    expect(res).toEqual({ outcome: "auth_required" });

    const hh = await readBack();
    expect(hh.bootstrapStatus).toBe("error");
    expect(hh.bootstrapError).toBe("auth_required");
    expect(hh.members).toHaveLength(0);
  });

  it("missing tool → error", async () => {
    const reader = fakeReader({
      listTools: async () => ({
        status: "ok",
        tools: [{ name: "silpo_get_my_profile", description: null }],
      }),
    });
    const res = await runBootstrap(householdId, deps(reader));
    expect(res.outcome).toBe("error");
    if (res.outcome === "error") expect(res.message).toMatch(/missing required tools/);
  });

  it("NoCartError on offline/favorites → still completes from online orders", async () => {
    const reader = fakeReader({
      getCartContext: async () => {
        throw new NoCartError();
      },
    });
    const res = await runBootstrap(householdId, deps(reader));
    expect(res.outcome).toBe("done");
  });

  it("does not overwrite an existing silpo_user_ref (the seed's 'demo' key)", async () => {
    await db
      .update(schema.households)
      .set({ silpoUserRef: `demo-${householdId}` })
      .where(eq(schema.households.id, householdId));

    await runBootstrap(householdId, deps(fakeReader()));

    const hh = await readBack();
    expect(hh.silpoUserRef).toBe(`demo-${householdId}`); // untouched
  });

  it("idempotent: re-run keeps member/restriction counts and a prior confirmation", async () => {
    await runBootstrap(householdId, deps(fakeReader()));
    // Guest confirms the milk allergy.
    await db
      .update(schema.householdRestrictions)
      .set({ confirmedAt: new Date() })
      .where(eq(schema.householdRestrictions.householdId, householdId));

    await runBootstrap(householdId, deps(fakeReader()));

    const hh = await readBack();
    expect(hh.members).toHaveLength(4);
    const milk = hh.restrictions.find((r) => r.code === "milk")!;
    expect(milk.confirmedAt).not.toBeNull(); // survived the re-bootstrap
    // exactly one row per (kind, code)
    const keys = hh.restrictions.map((r) => `${r.kind}:${r.code}`);
    expect(new Set(keys).size).toBe(keys.length);
    // T1.6 — receipt lines are replaced wholesale, not duplicated.
    expect(
      await db.$count(schema.receiptLines, eq(schema.receiptLines.householdId, householdId)),
    ).toBe(6);
  });
});
