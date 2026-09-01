import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CredentialStore } from "@navar/domain";

import { SilpoOAuthProvider } from "./oauth.js";

export interface InteractiveAuthOptions {
  mcpUrl: string;
  store: CredentialStore;
  householdId: string;
  callbackPort: number;
  /** Default true; set false in headless environments and open the printed URL manually. */
  openBrowser?: boolean;
}

function waitForCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") return void res.writeHead(404).end();
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<body style="font-family:sans-serif">${
          code ? "Authorised. You can close this tab." : `Authorisation failed: ${error}`
        }</body>`,
      );
      server.close();
      code ? resolve(code) : reject(new Error(`OAuth failed: ${error ?? "no code"}`));
    });
    server.listen(port, () =>
      console.log(`[mcp:auth] listening on http://localhost:${port}/callback`),
    );
  });
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  }).unref();
}

/**
 * One-time interactive OAuth: opens auth.silpo.ua, catches the loopback redirect,
 * exchanges the code, and persists the tokens via the `CredentialStore`. Idempotent —
 * a no-op if the household already has working credentials.
 */
export async function runInteractiveAuth(opts: InteractiveAuthOptions): Promise<void> {
  const redirectUrl = `http://localhost:${opts.callbackPort}/callback`;
  const provider = new SilpoOAuthProvider({
    store: opts.store,
    householdId: opts.householdId,
    redirectUrl,
    onAuthorizationUrl: (url) => {
      console.log(`\n[mcp:auth] open if the browser did not:\n${url}\n`);
      if (opts.openBrowser !== false) openInBrowser(url.toString());
    },
  });

  const makeTransport = () =>
    new StreamableHTTPClientTransport(new URL(opts.mcpUrl), { authProvider: provider });
  const makeClient = () =>
    new Client({ name: "navar-mcp-auth", version: "0.0.0" }, { capabilities: {} });

  const codePromise = waitForCode(opts.callbackPort);

  try {
    await makeClient().connect(makeTransport());
    console.log("[mcp:auth] already authorised — nothing to do");
    return;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
  }

  const transport = makeTransport();
  await transport.finishAuth(await codePromise);
  console.log("[mcp:auth] tokens stored");

  const client = makeClient();
  await client.connect(makeTransport());
  const { tools } = await client.listTools();
  console.log(`[mcp:auth] verified — ${tools.length} tools available`);
  await client.close();
}
