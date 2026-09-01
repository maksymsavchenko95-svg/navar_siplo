import { closeDb, db, pgCredentialStore, schema } from "@navar/db";
import { runInteractiveAuth } from "@navar/retail";

import { env } from "../env.js";

/**
 * `pnpm mcp:auth` — one-time interactive Silpo OAuth. Ensures a P0 household row exists,
 * then runs the loopback browser flow and stores the encrypted tokens against it.
 * Run on the host (needs a browser).
 */
async function main(): Promise<void> {
  let [hh] = await db.select({ id: schema.households.id }).from(schema.households).limit(1);
  if (!hh) {
    [hh] = await db.insert(schema.households).values({}).returning({ id: schema.households.id });
    console.log(`[mcp:auth] created household ${hh!.id}`);
  }

  await runInteractiveAuth({
    mcpUrl: env.SILPO_MCP_URL,
    store: pgCredentialStore,
    householdId: hh!.id,
    callbackPort: env.MCP_OAUTH_CALLBACK_PORT,
  });
}

main()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
