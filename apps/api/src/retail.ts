import { pgCredentialStore } from "@navar/db";
import { type RetailProvider, SilpoRetailProvider } from "@navar/retail";

import { env } from "./env.js";
import { resolveHouseholdId } from "./household.js";

// Placeholder used only until the seed / mcp:auth has created a household; with it the
// provider simply reports `auth_required`.
const NO_HOUSEHOLD = "00000000-0000-0000-0000-000000000000";

let provider: SilpoRetailProvider | undefined;

export async function getSilpoProvider(): Promise<SilpoRetailProvider> {
  if (!provider) {
    provider = new SilpoRetailProvider({
      mcpUrl: env.SILPO_MCP_URL,
      store: pgCredentialStore,
      householdId: (await resolveHouseholdId()) ?? NO_HOUSEHOLD,
      redirectUrl: `http://localhost:${env.MCP_OAUTH_CALLBACK_PORT}/callback`,
    });
  }
  return provider;
}

export function getRetail(): Promise<RetailProvider> {
  return getSilpoProvider();
}

/** Warm-up on boot: `tools/list` once so the trace shows up early (INT-MCP-001). */
export async function initRetail(): Promise<void> {
  await (await getSilpoProvider()).init();
}
