import { randomUUID } from "node:crypto";

import { pgCredentialStore } from "@navar/db";
import { type AuthStatus, type LogoutResult, type StartLoginResult } from "@navar/domain";

import { beginLogin, disconnectHousehold } from "../../auth-flow.js";
import { connection } from "../../queue/connection.js";
import { sessions } from "../../session.js";
import { SESSION_COOKIE } from "../context.js";
import { protectedProcedure, publicProcedure, router } from "../trpc.js";

export const PENDING_COOKIE = "navar_oauth_pending";
const PENDING_PREFIX = "navar:oauth:pending:";
const PENDING_TTL_S = 600;

/** Stash `pendingHouseholdId` under a fresh nonce; the nonce goes in a short-lived cookie. */
export async function stashPending(householdId: string): Promise<string> {
  const nonce = randomUUID();
  await connection.set(PENDING_PREFIX + nonce, householdId, "EX", PENDING_TTL_S);
  return nonce;
}

/** Consume a pending nonce → the household id it was created for. */
export async function takePending(nonce: string | undefined): Promise<string | null> {
  if (!nonce) return null;
  const id = await connection.get(PENDING_PREFIX + nonce);
  if (id) await connection.del(PENDING_PREFIX + nonce);
  return id;
}

export const authRouter = router({
  /**
   * `FR-AUTH-002` — is there a session backed by a Silpo token? This is a *presence* check:
   * an expired / revoked token still reports `connected` until a protected call fails against
   * the MCP. A "reconnect needed" affordance in the web app is follow-up work.
   */
  status: publicProcedure.query(async ({ ctx }): Promise<AuthStatus> => {
    if (!ctx.householdId) return { connected: false };
    const creds = await pgCredentialStore.load(ctx.householdId);
    return creds?.tokens?.access_token
      ? { connected: true, householdId: ctx.householdId }
      : { connected: false };
  }),

  /** Begin the Silpo OAuth flow; the browser navigates to the returned URL. */
  startLogin: publicProcedure.mutation(async ({ ctx }): Promise<StartLoginResult> => {
    const { url, householdId } = await beginLogin();
    const nonce = await stashPending(householdId);
    // See index.ts callback: `secure` needs `trustProxy` behind TLS; `sameSite` may need
    // "none" if web + API are split across unrelated domains.
    ctx.res.setCookie(PENDING_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.req.protocol === "https",
      path: "/",
      maxAge: PENDING_TTL_S,
    });
    return { url };
  }),

  /** Drop the session + the Silpo token. The household row + its plans stay. */
  logout: protectedProcedure.mutation(async ({ ctx }): Promise<LogoutResult> => {
    await sessions.destroy(ctx.sessionId ?? undefined);
    await disconnectHousehold(ctx.householdId);
    ctx.res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }),
});
