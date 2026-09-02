import { db, pgCredentialStore, schema } from "@navar/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAccount, sweepStaleHouseholds } from "../../auth-flow.js";
import { appRouter } from "../router.js";
import { testContext } from "../test-context.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("auth.status", () => {
  it("no session → not connected", async () => {
    const caller = appRouter.createCaller(testContext({ householdId: null }));
    expect(await caller.auth.status()).toEqual({ connected: false });
  });

  it.skipIf(!HAS_DB)("session but no stored Silpo token → not connected", async () => {
    const [hh] = await db.insert(schema.households).values({}).returning();
    try {
      const caller = appRouter.createCaller(testContext({ householdId: hh!.id }));
      expect(await caller.auth.status()).toEqual({ connected: false });
    } finally {
      await db.delete(schema.households).where(eq(schema.households.id, hh!.id));
    }
  });
});

describe.skipIf(!HAS_DB)("resolveAccount", () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const id of created.splice(0)) {
      await db
        .delete(schema.households)
        .where(eq(schema.households.id, id))
        .catch(() => {});
    }
  });

  async function newHousehold(silpoUserRef?: string) {
    const [hh] = await db
      .insert(schema.households)
      .values(silpoUserRef ? { silpoUserRef } : {})
      .returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("first login: stamps silpo_user_ref onto the pending household", async () => {
    const pending = await newHousehold();
    const ref = `prof-${pending}`;
    expect(await resolveAccount(ref, pending)).toBe(pending);
    const [row] = await db
      .select({ ref: schema.households.silpoUserRef })
      .from(schema.households)
      .where(eq(schema.households.id, pending));
    expect(row!.ref).toBe(ref);
  });

  it("reconnect: migrates tokens to the existing household and deletes the throwaway", async () => {
    const ref = `prof-reconnect-${Date.now()}`;
    const existing = await newHousehold(ref);
    const pending = await newHousehold();
    await pgCredentialStore.save(pending, {
      expiresAt: 0,
      tokens: { access_token: "t", token_type: "Bearer" },
    });

    expect(await resolveAccount(ref, pending)).toBe(existing);

    expect(await db.$count(schema.households, eq(schema.households.id, pending))).toBe(0);
    expect((await pgCredentialStore.load(existing))?.tokens?.access_token).toBe("t");
  });
});

describe.skipIf(!HAS_DB)("sweepStaleHouseholds", () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const id of created.splice(0)) {
      await db
        .delete(schema.households)
        .where(eq(schema.households.id, id))
        .catch(() => {});
    }
  });

  it("deletes only abandoned throwaway rows (null ref, older than 1h)", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const [stale] = await db
      .insert(schema.households)
      .values({ createdAt: twoHoursAgo })
      .returning();
    const [fresh] = await db.insert(schema.households).values({}).returning();
    const [old_but_claimed] = await db
      .insert(schema.households)
      .values({ silpoUserRef: `prof-sweep-${Date.now()}`, createdAt: twoHoursAgo })
      .returning();
    created.push(stale!.id, fresh!.id, old_but_claimed!.id);

    await sweepStaleHouseholds();

    expect(await db.$count(schema.households, eq(schema.households.id, stale!.id))).toBe(0);
    expect(await db.$count(schema.households, eq(schema.households.id, fresh!.id))).toBe(1);
    expect(await db.$count(schema.households, eq(schema.households.id, old_but_claimed!.id))).toBe(
      1,
    );
  });
});
