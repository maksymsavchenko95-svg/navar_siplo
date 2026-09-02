import { afterAll, describe, expect, it } from "vitest";

import { connection } from "./queue/connection.js";
import { sessions } from "./session.js";

// Redis + Postgres come up together (`pnpm dev` / CI), so gate on the same flag as the DB suites.
describe.skipIf(!process.env.DATABASE_URL && !process.env.REDIS_URL)("sessions (Redis)", () => {
  afterAll(() => connection.disconnect());

  it("create → get → destroy", async () => {
    const sid = await sessions.create("hh-abc");
    const data = await sessions.get(sid);
    expect(data?.householdId).toBe("hh-abc");

    await sessions.destroy(sid);
    expect(await sessions.get(sid)).toBeNull();
  });

  it("get refreshes the TTL (sliding expiry)", async () => {
    const sid = await sessions.create("hh-ttl");
    await connection.expire(`navar:sess:${sid}`, 5);
    await sessions.get(sid);
    expect(await connection.ttl(`navar:sess:${sid}`)).toBeGreaterThan(5);
    await sessions.destroy(sid);
  });

  it("unknown / undefined id → null", async () => {
    expect(await sessions.get("nope")).toBeNull();
    expect(await sessions.get(undefined)).toBeNull();
  });
});
