import { db, pgCredentialStore, schema } from "@navar/db";
import { beginWebLogin, finishWebLogin, type WebAuthOptions } from "@navar/retail";
import { eq, sql } from "drizzle-orm";

import { env } from "./env.js";
import { appOAuthClient, forgetRetail, getRetail, OAUTH_REDIRECT_URL } from "./retail.js";

/**
 * The web Silpo OAuth flow (`FR-AUTH-001/002`), orchestrated across `auth.startLogin` and
 * the `/auth/silpo/callback` route. The MCP SDK stays inside `@navar/retail`; this file
 * only does the household/session bookkeeping.
 */

function webAuthOptions(householdId: string): WebAuthOptions {
  return {
    mcpUrl: env.SILPO_MCP_URL,
    redirectUrl: OAUTH_REDIRECT_URL,
    store: pgCredentialStore,
    householdId,
    appClientInformation: appOAuthClient,
  };
}

/** Step 1: throwaway household + the `/authorize` URL (PKCE verifier stored against it). */
export async function beginLogin(): Promise<{ url: string; householdId: string }> {
  // Best-effort GC of throwaway rows from abandoned / double-clicked logins. Non-blocking.
  void sweepStaleHouseholds().catch((err) =>
    console.warn("[auth] stale-household sweep failed", err),
  );
  const [row] = await db
    .insert(schema.households)
    .values({})
    .returning({ id: schema.households.id });
  const householdId = row!.id;
  const { url } = await beginWebLogin(webAuthOptions(householdId));
  return { url, householdId };
}

/** Step 2: exchange the code, read the Silpo profile, settle on the real account. */
export async function completeLogin(
  pendingHouseholdId: string,
  code: string,
): Promise<{ householdId: string }> {
  await finishWebLogin(webAuthOptions(pendingHouseholdId), code);
  const profile = await getRetail(pendingHouseholdId).getProfile();
  const householdId = await resolveAccount(profile.silpoProfileId, pendingHouseholdId);
  if (householdId !== pendingHouseholdId) forgetRetail(pendingHouseholdId);
  return { householdId };
}

/**
 * Reconcile a freshly-authed throwaway household with any existing one for the same Silpo
 * profile (dedup on `silpo_user_ref`). Returns the id the session should point at.
 */
export async function resolveAccount(
  silpoProfileId: string,
  pendingHouseholdId: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.silpoUserRef, silpoProfileId));

  if (!existing) {
    await db
      .update(schema.households)
      .set({ silpoUserRef: silpoProfileId })
      .where(eq(schema.households.id, pendingHouseholdId));
    return pendingHouseholdId;
  }
  if (existing.id === pendingHouseholdId) return pendingHouseholdId;

  const tokens = await pgCredentialStore.load(pendingHouseholdId);
  if (tokens) await pgCredentialStore.save(existing.id, tokens);
  await db.delete(schema.households).where(eq(schema.households.id, pendingHouseholdId));
  return existing.id;
}

/** Logout: clear the Silpo token + drop the cached provider. Household + plans stay. */
export async function disconnectHousehold(householdId: string): Promise<void> {
  await pgCredentialStore.clear(householdId);
  forgetRetail(householdId);
}

/** Best-effort sweep of abandoned logins (household created, never authed). */
export async function sweepStaleHouseholds(): Promise<number> {
  const res = await db
    .delete(schema.households)
    .where(
      sql`${schema.households.silpoUserRef} is null and ${schema.households.createdAt} < now() - interval '1 hour'`,
    );
  return res.rowCount ?? 0;
}
