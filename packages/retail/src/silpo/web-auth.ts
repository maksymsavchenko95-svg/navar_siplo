import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CredentialStore } from "@navar/domain";

import { SilpoOAuthProvider } from "./oauth.js";

/**
 * The **web** Silpo OAuth flow (`FR-AUTH-001/002`), split across two stateless HTTP
 * requests. `SilpoOAuthProvider` persists the PKCE verifier to the `CredentialStore`, so
 * `begin` (produce the `/authorize` URL) and `finish` (exchange the code) can be separate
 * requests. Keeps the MCP SDK inside `@navar/retail` (ADR-04). The CLI loopback flow lives
 * in `auth-flow.ts`.
 */

export interface WebAuthOptions {
  mcpUrl: string;
  redirectUrl: string;
  store: CredentialStore;
  householdId: string;
  appClientInformation: () => Promise<OAuthClientInformationFull>;
}

function provider(opts: WebAuthOptions, onAuthorizationUrl?: (u: URL) => void) {
  return new SilpoOAuthProvider({
    store: opts.store,
    householdId: opts.householdId,
    redirectUrl: opts.redirectUrl,
    appClientInformation: opts.appClientInformation,
    onAuthorizationUrl,
  });
}

/** Drive the SDK to the `/authorize` URL; the PKCE verifier is stored against `householdId`. */
export async function beginWebLogin(opts: WebAuthOptions): Promise<{ url: string }> {
  let url: URL | undefined;
  const transport = new StreamableHTTPClientTransport(new URL(opts.mcpUrl), {
    authProvider: provider(opts, (u) => {
      url = u;
    }),
  });
  try {
    await new Client({ name: "navar-login", version: "0.0.0" }, { capabilities: {} }).connect(
      transport,
    );
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
  }
  if (!url) throw new Error("Silpo OAuth: no authorization URL produced");
  return { url: url.toString() };
}

/** Exchange the authorization code for tokens, stored against `householdId`. */
export async function finishWebLogin(opts: WebAuthOptions, code: string): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(opts.mcpUrl), {
    authProvider: provider(opts),
  });
  await transport.finishAuth(code);
}
