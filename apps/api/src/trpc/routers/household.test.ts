import { db, schema } from "@navar/db";
import { computeNutritionTargets } from "@navar/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveHouseholdId } from "../../household.js";
import { createContext } from "../context.js";
import { appRouter } from "../router.js";
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
  let snapshot: { goal: string; targets: typeof schema.nutritionTargets.$inferSelect | undefined };

  beforeAll(async () => {
    caller = appRouter.createCaller(await createContext({} as never));
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    householdId = id;
    const [hh] = await db
      .select({ goal: schema.households.goal })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    const [targets] = await db
      .select()
      .from(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    snapshot = { goal: hh!.goal, targets };
  });

  afterAll(async () => {
    await db
      .update(schema.households)
      .set({ goal: snapshot.goal })
      .where(eq(schema.households.id, householdId));
    await db
      .delete(schema.nutritionTargets)
      .where(eq(schema.nutritionTargets.householdId, householdId));
    if (snapshot.targets) await db.insert(schema.nutritionTargets).values(snapshot.targets);
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
