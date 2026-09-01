/**
 * Port for MCP token storage. Tokens are always encrypted at rest and scoped to a
 * household (SRS `NFR-SEC-001`, TDD §3 `mcp_credentials`). `@navar/db` implements this;
 * `@navar/retail` consumes it. Defined here so neither depends on the other.
 *
 * The shapes are intentionally loose (structural, no SDK import) — `@navar/retail` maps
 * them to/from the MCP SDK's OAuth types.
 */

export interface OAuthTokenSet {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface StoredMcpTokens {
  /** The latest OAuth token set, or undefined before the first exchange. */
  tokens?: OAuthTokenSet;
  /** Dynamic Client Registration result, needed to refresh. */
  clientInformation?: unknown;
  /** Transient PKCE verifier, kept only between `/authorize` and the token exchange. */
  codeVerifier?: string;
  /** Epoch ms of access-token expiry; 0 when unknown. Duplicated in clear in the DB. */
  expiresAt: number;
}

export interface CredentialStore {
  load(householdId: string): Promise<StoredMcpTokens | undefined>;
  save(householdId: string, tokens: StoredMcpTokens): Promise<void>;
  clear(householdId: string): Promise<void>;
}
