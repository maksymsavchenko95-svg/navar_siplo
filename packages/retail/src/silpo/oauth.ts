import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CredentialStore, StoredMcpTokens } from "@navar/domain";

export interface SilpoOAuthOptions {
  store: CredentialStore;
  householdId: string;
  /** Loopback URL the one-time interactive flow listens on. */
  redirectUrl: string;
  /** Called with the authorization URL during the interactive flow. */
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
}

/**
 * `OAuthClientProvider` for the Silpo MCP, backed by a `CredentialStore` (so tokens are
 * encrypted at rest, per household). Each write is a load-merge-save on the stored blob,
 * because the SDK persists client info, verifier and tokens at different points.
 */
export class SilpoOAuthProvider implements OAuthClientProvider {
  constructor(private readonly opts: SilpoOAuthOptions) {}

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Navar (Silpo AI Factory)",
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async #loadState(): Promise<StoredMcpTokens> {
    return (await this.opts.store.load(this.opts.householdId)) ?? { expiresAt: 0 };
  }

  async #merge(patch: Partial<StoredMcpTokens>): Promise<void> {
    const next = { ...(await this.#loadState()), ...patch };
    if (patch.tokens) {
      next.expiresAt = patch.tokens.expires_in ? Date.now() + patch.tokens.expires_in * 1000 : 0;
    }
    await this.opts.store.save(this.opts.householdId, next);
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return (await this.#loadState()).clientInformation as OAuthClientInformation | undefined;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await this.#merge({ clientInformation: info });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.#loadState()).tokens as OAuthTokens | undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.#merge({ tokens });
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.#merge({ codeVerifier: verifier });
  }

  async codeVerifier(): Promise<string> {
    const v = (await this.#loadState()).codeVerifier;
    if (!v) throw new Error("No PKCE code_verifier stored — run the mcp:auth flow");
    return v;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.opts.onAuthorizationUrl?.(authorizationUrl);
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
    if (scope === "all") return this.opts.store.clear(this.opts.householdId);
    const state = await this.#loadState();
    if (scope === "client") delete state.clientInformation;
    if (scope === "tokens") state.tokens = undefined;
    if (scope === "verifier") delete state.codeVerifier;
    await this.opts.store.save(this.opts.householdId, state);
  }
}
