import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { CredentialStore, StoredMcpTokens } from "@navar/domain";
import { eq } from "drizzle-orm";

import { db } from "./client.js";
import { dbEnv } from "./env.js";
import { mcpCredentials } from "./schema.js";

/**
 * Postgres-backed `CredentialStore` (TDD §3 `mcp_credentials`). The full token set is
 * serialised to JSON and stored as one AES-256-GCM ciphertext (`iv | tag | data`);
 * `expires_at` is duplicated in clear for refresh checks. Requires `MCP_TOKEN_KEY`.
 */

function key(): Buffer {
  if (!dbEnv.MCP_TOKEN_KEY) {
    throw new Error("MCP_TOKEN_KEY is not set — cannot read or write MCP credentials");
  }
  return Buffer.from(dbEnv.MCP_TOKEN_KEY, "base64");
}

function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

function decrypt(payload: Buffer): string {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const data = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export const pgCredentialStore: CredentialStore = {
  async load(householdId) {
    const [row] = await db
      .select()
      .from(mcpCredentials)
      .where(eq(mcpCredentials.householdId, householdId));
    if (!row) return undefined;
    return JSON.parse(decrypt(row.payload)) as StoredMcpTokens;
  },

  async save(householdId, tokens) {
    const payload = encrypt(JSON.stringify(tokens));
    const expiresAt = new Date(tokens.expiresAt);
    await db
      .insert(mcpCredentials)
      .values({ householdId, payload, expiresAt })
      .onConflictDoUpdate({
        target: mcpCredentials.householdId,
        set: { payload, expiresAt, updatedAt: new Date() },
      });
  },

  async clear(householdId) {
    await db.delete(mcpCredentials).where(eq(mcpCredentials.householdId, householdId));
  },
};
