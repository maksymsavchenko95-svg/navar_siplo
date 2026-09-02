import { db, schema } from "@navar/db";
import { asc } from "drizzle-orm";

/**
 * Script / test helper only — request paths use `ctx.householdId` from the session
 * (`FR-AUTH-002`). Web login now creates additional `households` rows, so a bare
 * `LIMIT 1` is non-deterministic: prefer the seeded demo household, then the oldest.
 */
let cached: string | undefined;

export async function resolveHouseholdId(): Promise<string | undefined> {
  if (cached) return cached;
  const rows = await db
    .select({ id: schema.households.id, ref: schema.households.silpoUserRef })
    .from(schema.households)
    .orderBy(asc(schema.households.createdAt));
  cached = (rows.find((r) => r.ref === "demo") ?? rows[0])?.id;
  return cached;
}
