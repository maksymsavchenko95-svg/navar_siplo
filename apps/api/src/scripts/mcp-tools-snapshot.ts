import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

import { closeDb } from "@navar/db";

import { getSilpoProvider } from "../retail.js";

/**
 * `pnpm mcp:tools-snapshot` — write the raw Silpo `tools/list` response (full schemas) to
 * docs/mcp-tools-snapshot.json. The committed file is the day-1 contract fixation (audit
 * checklist Block 0): a reference for humans, never a source to hardcode tool names from.
 * Needs credentials — run `pnpm mcp:auth` first.
 */
const OUT = fileURLToPath(new URL("../../../../docs/mcp-tools-snapshot.json", import.meta.url));

async function main(): Promise<void> {
  const raw = await (await getSilpoProvider()).rawToolList();
  const tools = (raw as { tools?: unknown[] }).tools ?? [];
  await writeFile(OUT, JSON.stringify(raw, null, 2) + "\n", "utf8");
  console.log(`[mcp:tools-snapshot] wrote ${tools.length} tools → docs/mcp-tools-snapshot.json`);
}

main()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
