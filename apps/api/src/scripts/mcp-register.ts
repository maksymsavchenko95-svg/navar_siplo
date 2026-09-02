import { closeDb } from "@navar/db";
import { registerAppClient } from "@navar/retail";

import { env } from "../env.js";
import { OAUTH_REDIRECT_URL } from "../retail.js";

/**
 * `pnpm mcp:register` — one-time Dynamic Client Registration of Navar's shared Silpo OAuth
 * client. Prints the JSON to pin as `SILPO_OAUTH_CLIENT` in `.env` (and docker-compose /
 * the deploy env). Without it the API lazily registers on first login and caches in Redis.
 *
 * The `redirect_uris` are baked in at registration, so run this **after** `PUBLIC_API_URL`
 * is set to the real deployed origin.
 */
async function main(): Promise<void> {
  console.log(`[mcp:register] redirect_uri = ${OAUTH_REDIRECT_URL}`);
  const client = await registerAppClient({
    mcpUrl: env.SILPO_MCP_URL,
    redirectUrl: OAUTH_REDIRECT_URL,
  });
  console.log("\n[mcp:register] registered. Add to .env:\n");
  console.log(`SILPO_OAUTH_CLIENT='${JSON.stringify(client)}'\n`);
}

main()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
