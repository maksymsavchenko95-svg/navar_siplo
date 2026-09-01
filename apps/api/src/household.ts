import { db, schema } from "@navar/db";

/**
 * P0 is single-household. Resolve the one household the seed created (or the one
 * `mcp:auth` bootstrapped) and memoise it. Multi-household selection arrives with app
 * sessions (SRS `FR-AUTH-002`).
 */
let cached: string | undefined;

export async function resolveHouseholdId(): Promise<string | undefined> {
  if (cached) return cached;
  const [row] = await db.select({ id: schema.households.id }).from(schema.households).limit(1);
  cached = row?.id;
  return cached;
}
