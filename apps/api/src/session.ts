import { randomUUID } from "node:crypto";

import { env } from "./env.js";
import { connection } from "./queue/connection.js";

/**
 * System sessions (`FR-AUTH-002`) — the client holds an opaque session id in an httpOnly
 * cookie; the Silpo token never leaves the backend. Stored in Redis (already up for BullMQ),
 * keyed `navar:sess:<id>` → `{ householdId }`, with a sliding TTL.
 */

const PREFIX = "navar:sess:";

export interface SessionData {
  householdId: string;
  createdAt: string;
}

export const sessions = {
  async create(householdId: string): Promise<string> {
    const id = randomUUID();
    const data: SessionData = { householdId, createdAt: new Date().toISOString() };
    await connection.set(PREFIX + id, JSON.stringify(data), "EX", env.SESSION_TTL_S);
    return id;
  },

  /** Look up a session and refresh its TTL. `null` on miss / malformed. */
  async get(id: string | undefined): Promise<SessionData | null> {
    if (!id) return null;
    const raw = await connection.get(PREFIX + id);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SessionData;
      await connection.expire(PREFIX + id, env.SESSION_TTL_S);
      return data;
    } catch {
      return null;
    }
  },

  async destroy(id: string | undefined): Promise<void> {
    if (id) await connection.del(PREFIX + id);
  },
};
