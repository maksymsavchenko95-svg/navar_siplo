import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CredentialStore, McpToolsResult } from "@navar/domain";

import type { RetailProvider } from "../provider.js";
import { toToolSummaries } from "../summaries.js";
import { SilpoOAuthProvider } from "./oauth.js";

export interface SilpoRetailProviderOptions {
  mcpUrl: string;
  store: CredentialStore;
  householdId: string;
  /** Loopback redirect for the interactive auth flow; unused at runtime once connected. */
  redirectUrl: string;
}

const AUTH_HINT = "run `pnpm mcp:auth` (one-time Silpo login)";

/** Retry `fn` on JSON-RPC 429 with exponential backoff (rules/mcp-integration.md). */
async function withBackoff<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as { code?: number }).code !== 429 || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

/**
 * Silpo implementation of `RetailProvider`. Connects lazily, calls `tools/list` once and
 * caches it (`INT-MCP-001` — never hardcode tool names). Cart context, search and writes
 * are added here as features land; nothing outside this class imports the MCP SDK.
 */
export class SilpoRetailProvider implements RetailProvider {
  private client: Client | undefined;
  private toolsCache: McpToolsResult | undefined;

  constructor(private readonly opts: SilpoRetailProviderOptions) {}

  /** Optional warm-up on server boot. Never throws. */
  async init(): Promise<void> {
    try {
      const result = await this.listTools();
      if (result.status === "ok") {
        console.log(`[retail] connected, ${result.tools.length} Silpo MCP tools`);
      } else {
        console.warn(`[retail] not connected — ${result.hint}`);
      }
    } catch (err) {
      console.error("[retail] init failed:", err instanceof Error ? err.message : err);
    }
  }

  async listTools(): Promise<McpToolsResult> {
    if (this.toolsCache) return this.toolsCache;

    const stored = await this.opts.store.load(this.opts.householdId);
    if (!stored?.tokens?.access_token) return { status: "auth_required", hint: AUTH_HINT };

    try {
      await this.connect();
      const { tools } = await withBackoff(() => this.client!.listTools());
      this.toolsCache = { status: "ok", tools: toToolSummaries(tools) };
      return this.toolsCache;
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: "auth_required", hint: AUTH_HINT };
      throw new Error(`Silpo MCP error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Raw `tools/list` response, full schemas, uncached. For the committed contract
   * snapshot (`pnpm mcp:tools-snapshot`, audit checklist Block 0) — not a runtime path.
   */
  async rawToolList(): Promise<unknown> {
    await this.connect();
    return withBackoff(() => this.client!.listTools());
  }

  private async connect(): Promise<void> {
    if (this.client) return;
    const client = new Client({ name: "navar", version: "0.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(this.opts.mcpUrl), {
      authProvider: new SilpoOAuthProvider({
        store: this.opts.store,
        householdId: this.opts.householdId,
        redirectUrl: this.opts.redirectUrl,
      }),
    });
    await client.connect(transport);
    this.client = client;
  }
}
