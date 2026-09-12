import { db, schema } from "@navar/db";
import { computeNutritionTargets } from "@navar/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveHouseholdId } from "../../household.js";
import { appRouter } from "../router.js";
import { testContext } from "../test-context.js";
import { parseCardId } from "./household.js";

describe("parseCardId", () => {
  it("parses a restriction card id (kind + code, code may contain colons)", () => {
    expect(parseCardId("restriction:allergen:milk")).toEqual({
      type: "restriction",
      kind: "allergen",
      code: "milk",
    });
    expect(parseCardId("restriction:dislike:name:пучок кропу")).toEqual({
      type: "restriction",
      kind: "dislike",
      code: "name:пучок кропу",
    });
  });

  it("parses an often/rarely item card id, keeping only slug keys", () => {
    expect(parseCardId("often:milk")).toEqual({ type: "item", slug: "milk" });
    expect(parseCardId("rarely:lager:999")).toEqual({ type: "item", slug: null });
  });

  it("returns null for an unknown id or bad kind", () => {
    expect(parseCardId("weird:thing")).toBeNull();
    expect(parseCardId("restriction:bogus:x")).toBeNull();
  });
});

/**
 * Integration — hits the seeded demo household. Gated on DATABASE_URL like the
 * `packages/db` importer tests. Snapshots and restores the mutated rows so a re-run and
 * `pnpm db:seed` both stay clean.
 */
describe.skipIf(!process.env.DATABASE_URL)("household router (integration)", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let householdId: string;
  let snapshot: {
    goal: string;
    weeklyBudget: string | null;
    targets: typeof schema.nutritionTargets.$inferSelect | undefined;
    members: (typeof schema.householdMembers.$inferSelect)[];
  };

  beforeAll(async () => {
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    householdId = id;
    caller = appRouter.createCaller(testContext({ householdId }));
    const [hh] = await db
      .select({ goal: schema.households.goal, weeklyBudget: schema.households.weeklyBudget })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    const [targets] = await db
      .select()
      .from(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    const members = await db
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, householdId));
    snapshot = { goal: hh!.goal, weeklyBudget: hh!.weeklyBudget, targets, members };
  });

  afterAll(async () => {
    await db
      .update(schema.households)
      .set({ goal: snapshot.goal, weeklyBudget: snapshot.weeklyBudget })
      .where(eq(schema.households.id, householdId));
    await db
      .delete(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    if (snapshot.targets) await db.insert(schema.nutritionTargets).values(snapshot.targets);
    // Restore the exact member rows — `plan.test.ts` in this package asserts
    // `input.servings === 3` off them and the suite runs with no file parallelism.
    await db
      .delete(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, householdId));
    if (snapshot.members.length > 0)
      await db.insert(schema.householdMembers).values(snapshot.members);
  });

  it("setGoal flips households.goal and round-trips", async () => {
    expect(await caller.household.setGoal({ goal: "routine" })).toEqual({
      status: "ok",
      goal: "routine",
    });
    const [a] = await db
      .select({ goal: schema.households.goal })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    expect(a!.goal).toBe("routine");

    await caller.household.setGoal({ goal: "form" });
    const [b] = await db
      .select({ goal: schema.households.goal })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    expect(b!.goal).toBe("form");
  });

  it("setBudget writes households.weekly_budget and household.get reflects it", async () => {
    expect(await caller.household.setBudget({ weeklyBudgetUah: 3200 })).toEqual({
      status: "ok",
      weeklyBudgetUah: 3200,
    });
    const [row] = await db
      .select({ weeklyBudget: schema.households.weeklyBudget })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    expect(Number(row!.weeklyBudget)).toBe(3200);

    const got = await caller.household.get();
    expect(got.status).toBe("ok");
    if (got.status !== "ok") return;
    expect(got.household.weeklyBudgetUah).toBe(3200);

    // overwrites unconditionally (unlike bootstrap's write-if-null)
    await caller.household.setBudget({ weeklyBudgetUah: 4500 });
    const [row2] = await db
      .select({ weeklyBudget: schema.households.weeklyBudget })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    expect(Number(row2!.weeklyBudget)).toBe(4500);
  });

  it("setMembers replaces adult/child rows with guest-sourced counts and returns the reloaded view", async () => {
    const res = await caller.household.setMembers({ adults: 4, children: 2 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    const nonPet = res.members.filter((m) => m.kind !== "pet");
    expect(nonPet.filter((m) => m.kind === "adult")).toHaveLength(4);
    expect(nonPet.filter((m) => m.kind === "child")).toHaveLength(2);
    expect(nonPet.every((m) => m.source === "guest")).toBe(true);
    expect(nonPet.every((m) => m.ageYears === null)).toBe(true);

    const got = await caller.household.get();
    if (got.status !== "ok") throw new Error("expected ok");
    expect(got.members.filter((m) => m.kind !== "pet")).toHaveLength(6);
  });

  it("setMembers preserves existing pet rows", async () => {
    await db.insert(schema.householdMembers).values({
      householdId,
      kind: "pet",
      ageYears: null,
      label: null,
      source: "silpo",
    });
    await caller.household.setMembers({ adults: 2, children: 1 });
    const rows = await db
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, householdId));
    expect(rows.filter((m) => m.kind === "pet")).toHaveLength(1);
    expect(rows.filter((m) => m.kind === "adult")).toHaveLength(2);
    expect(rows.filter((m) => m.kind === "child")).toHaveLength(1);
  });

  it("setMembers is idempotent", async () => {
    await caller.household.setMembers({ adults: 3, children: 1 });
    await caller.household.setMembers({ adults: 3, children: 1 });
    const rows = await db
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, householdId));
    expect(rows.filter((m) => m.kind !== "pet")).toHaveLength(4);
  });

  it("setMembers rejects out-of-range counts", async () => {
    await expect(caller.household.setMembers({ adults: 0, children: 0 })).rejects.toThrow();
    await expect(caller.household.setMembers({ adults: 2, children: 13 })).rejects.toThrow();
  });

  it("computeNutrition writes the computed targets and is idempotent", async () => {
    const input = {
      sex: "male",
      ageYears: 41,
      weightKg: 82,
      heightCm: 180,
      activity: "active",
      direction: "maintain",
    } as const;
    const expected = computeNutritionTargets(input);

    const r1 = await caller.household.computeNutrition(input);
    expect(r1.status).toBe("ok");
    if (r1.status !== "ok") return;
    expect(r1.targets.kcalTarget).toBe(expected.kcalTarget);
    expect(r1.targets.proteinMinG).toBe(expected.proteinMinG);
    expect(r1.targets).not.toHaveProperty("bmr");

    const [row1] = await db
      .select()
      .from(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    expect(row1!.kcalTarget).toBe(expected.kcalTarget);

    const r2 = await caller.household.computeNutrition(input);
    expect(r2).toEqual(r1);
    const rows = await db
      .select()
      .from(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    expect(rows).toHaveLength(1); // upsert, not a second row
  });

  it("household.get surfaces the persisted nutrition targets (used by /plan's goal summary)", async () => {
    await db
      .delete(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    const before = await caller.household.get();
    if (before.status !== "ok") throw new Error("expected ok");
    expect(before.household.nutritionTargets).toBeNull();

    const input = {
      sex: "female",
      ageYears: 29,
      weightKg: 60,
      heightCm: 165,
      activity: "moderate",
      direction: "maintain",
    } as const;
    const computed = computeNutritionTargets(input);
    await caller.household.computeNutrition(input);

    const after = await caller.household.get();
    if (after.status !== "ok") throw new Error("expected ok");
    expect(after.household.nutritionTargets).toEqual({
      kcalTarget: computed.kcalTarget,
      proteinMinG: computed.proteinMinG,
    });
  });

  it("computeNutrition rejects a sub-floor target and writes nothing new", async () => {
    // seed a known-good row first
    await caller.household.computeNutrition({
      sex: "male",
      ageYears: 30,
      weightKg: 80,
      heightCm: 180,
      activity: "moderate",
      direction: "maintain",
    });
    const [before] = await db
      .select()
      .from(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));

    const res = await caller.household.computeNutrition({
      sex: "female",
      ageYears: 30,
      weightKg: 45,
      heightCm: 158,
      activity: "sedentary",
      direction: "reduce",
    });
    expect(res.status).toBe("rejected");
    if (res.status !== "rejected") return;
    expect(res.floorKcal).toBe(1200);
    expect(res.computedKcal).toBeLessThan(1200);
    expect(res.reason).toMatch(/floor/i);

    const [after] = await db
      .select()
      .from(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    expect(after).toEqual(before); // untouched — no clamp, no write
  });
});
