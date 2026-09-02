import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  registerClient,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * The **one** OAuth client Navar registers with Silpo, shared by every Guest's PKCE flow
 * (a public client — `token_endpoint_auth_method: "none"`). Standard for a hosted web app:
 * one Dynamic Client Registration, N users. Contrast the CLI `pnpm mcp:auth`, which still
 * does a throwaway per-household DCR against a loopback redirect.
 *
 * The registered `redirect_uris` are fixed at registration, so the app client and the
 * `/auth/silpo/callback` route must agree on `PUBLIC_API_URL`.
 */

/** The shared Silpo OAuth client blob — opaque to consumers (keeps the SDK inside this package). */
export type SilpoOAuthClient = OAuthClientInformationFull;

export interface AppClientStore {
  get(): Promise<SilpoOAuthClient | undefined>;
  set(client: SilpoOAuthClient): Promise<void>;
}

const CLIENT_METADATA = (redirectUrl: string) => ({
  client_name: "Navar (Silpo AI Factory)",
  redirect_uris: [redirectUrl],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none" as const,
});

async function authServerMetadata(mcpUrl: string): Promise<{
  url: string;
  metadata: AuthorizationServerMetadata | undefined;
}> {
  let authServerUrl = new URL(mcpUrl).origin;
  try {
    const resource = await discoverOAuthProtectedResourceMetadata(mcpUrl);
    if (resource.authorization_servers?.[0]) authServerUrl = resource.authorization_servers[0];
  } catch {
    // No protected-resource metadata — fall back to the MCP origin (Silpo's docs point at
    // /.well-known/oauth-authorization-server there).
  }
  return { url: authServerUrl, metadata: await discoverAuthorizationServerMetadata(authServerUrl) };
}

/** Perform Dynamic Client Registration once. Used by `pnpm mcp:register` and the lazy path. */
export async function registerAppClient(opts: {
  mcpUrl: string;
  redirectUrl: string;
}): Promise<OAuthClientInformationFull> {
  const { url, metadata } = await authServerMetadata(opts.mcpUrl);
  return registerClient(url, { metadata, clientMetadata: CLIENT_METADATA(opts.redirectUrl) });
}

/**
 * Resolve the shared client: a pinned `SILPO_OAUTH_CLIENT` JSON env (preferred in prod) →
 * the store (Redis) → a one-time DCR that is then cached in the store.
 */
export async function resolveAppOAuthClient(opts: {
  mcpUrl: string;
  redirectUrl: string;
  store: AppClientStore;
  envJson?: string;
  /** Override the DCR call (tests). */
  register?: (o: { mcpUrl: string; redirectUrl: string }) => Promise<SilpoOAuthClient>;
}): Promise<SilpoOAuthClient> {
  if (opts.envJson) return JSON.parse(opts.envJson) as SilpoOAuthClient;

  const cached = await opts.store.get();
  if (cached) return cached;

  const registered = await (opts.register ?? registerAppClient)(opts);
  await opts.store.set(registered);
  console.warn(
    "[oauth] registered a new Silpo client via DCR — pin it: run `pnpm mcp:register` and set SILPO_OAUTH_CLIENT",
  );
  return registered;
}
