import { pgCredentialStore } from "@navar/db";
import {
  type AppClientStore,
  resolveAppOAuthClient,
  type RetailProvider,
  SilpoRetailProvider,
  type SilpoOAuthClient,
} from "@navar/retail";

import { env } from "./env.js";
import { resolveHouseholdId } from "./household.js";
import { connection } from "./queue/connection.js";

/** The Silpo OAuth redirect — must match what the shared DCR client is registered with. */
export const OAUTH_REDIRECT_URL = `${env.PUBLIC_API_URL}/auth/silpo/callback`;

// ── shared app-level OAuth client ────────────────────────────────────────────

const CLIENT_KEY = "navar:oauth:client";

const redisAppClientStore: AppClientStore = {
  async get() {
    const raw = await connection.get(CLIENT_KEY);
    return raw ? (JSON.parse(raw) as SilpoOAuthClient) : undefined;
  },
  async set(client) {
    await connection.set(CLIENT_KEY, JSON.stringify(client));
  },
};

let appClientPromise: Promise<SilpoOAuthClient> | undefined;

/** The one Silpo OAuth client, resolved once (env pin → Redis → lazy DCR). */
export function appOAuthClient(): Promise<SilpoOAuthClient> {
  return (appClientPromise ??= resolveAppOAuthClient({
    mcpUrl: env.SILPO_MCP_URL,
    redirectUrl: OAUTH_REDIRECT_URL,
    store: redisAppClientStore,
    envJson: env.SILPO_OAUTH_CLIENT,
  }));
}

// ── per-household retail providers ──────────────────────────────────────────

const providers = new Map<string, SilpoRetailProvider>();

/** The `RetailProvider` for one household — its own tokens, its own short-lived caches. */
export function getRetail(householdId: string): SilpoRetailProvider {
  let p = providers.get(householdId);
  if (!p) {
    p = new SilpoRetailProvider({
      mcpUrl: env.SILPO_MCP_URL,
      store: pgCredentialStore,
      householdId,
      redirectUrl: OAUTH_REDIRECT_URL,
      appClientInformation: appOAuthClient,
    });
    providers.set(householdId, p);
  }
  return p;
}

/** Drop a household's cached provider (e.g. on logout, so a fresh login reconnects clean). */
export function forgetRetail(householdId: string): void {
  providers.delete(householdId);
}

/**
 * Script convenience only (`plan:probe`, `mapper:probe`, `mcp:audit*`): the first / only
 * household. Request paths use `ctx.retail` (per-session household).
 */
export async function getSilpoProvider(): Promise<SilpoRetailProvider> {
  const id = await resolveHouseholdId();
  if (!id) throw new Error("no household — run `pnpm mcp:auth` or `pnpm db:seed`");
  return getRetail(id);
}

export function getRetailForRequest(householdId: string): RetailProvider {
  return getRetail(householdId);
}

/** No-op at boot now — providers connect lazily per household. */
export async function initRetail(): Promise<void> {
  /* nothing to warm without a "current" household */
}
