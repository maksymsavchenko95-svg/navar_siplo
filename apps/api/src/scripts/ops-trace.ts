import { writeFileSync } from "node:fs";

import { closeDb, getMcpCallsByPlan } from "@navar/db";
import { summarizeTrace } from "@navar/domain";

import { resolveHouseholdId } from "../household.js";

/**
 * `pnpm --filter @navar/api ops:trace <planId> [--household <id>] [--out <file>]`
 *
 * Prints the recorded JSON-RPC MCP call trace for a plan (`FR-OPS-001`, `AC-P0-08`) —
 * every `silpo_*` / `tools/list` call made while generating and materialising it, with
 * duration, status, attempts and correlation id — and writes the full trace to
 * `ops-trace-<planId>.json` (the exportable artefact the hackathon rules ask for).
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const col = (s: string, n: number): string => s.slice(0, n).padEnd(n);

async function main(): Promise<void> {
  const planId =
    process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : arg("plan");
  if (!planId) {
    console.error("usage: pnpm --filter @navar/api ops:trace <planId> [--household <id>]");
    process.exitCode = 1;
    return;
  }

  const householdId = arg("household") ?? (await resolveHouseholdId());
  if (!householdId) {
    console.error("no household — run pnpm db:seed (or pass --household <id>)");
    process.exitCode = 1;
    return;
  }

  const calls = await getMcpCallsByPlan(planId, householdId);
  if (calls == null) {
    console.error(`plan ${planId} not found for household ${householdId}`);
    process.exitCode = 1;
    return;
  }
  if (calls.length === 0) {
    console.log(`plan ${planId} has no recorded MCP calls yet`);
    return;
  }

  console.log(`── MCP trace · plan ${planId} · ${calls.length} calls ──\n`);
  console.log(
    col("started", 26) +
      col("phase", 16) +
      col("tool", 34) +
      col("ms", 7) +
      col("try", 4) +
      col("status", 8) +
      "correlationId",
  );
  for (const c of calls) {
    console.log(
      col(c.startedAt, 26) +
        col(c.phase, 16) +
        col(c.tool, 34) +
        col(String(c.durationMs), 7) +
        col(String(c.attempts), 4) +
        col(c.cached ? "cache" : c.status === "ok" ? "ok" : `ERR ${c.errorCode ?? ""}`.trim(), 8) +
        c.correlationId,
    );
  }

  const s = summarizeTrace(calls);
  console.log(
    `\nΣ ${s.totalCalls} calls · ${s.okCalls} ok · ${s.errorCalls} error · ${s.cachedCalls} cached · ` +
      `${s.totalDurationMs} ms · ${s.correlationIds.length} correlation id(s)`,
  );
  const byTool = Object.entries(s.byTool).sort((a, b) => b[1].durationMs - a[1].durationMs);
  for (const [tool, agg] of byTool) {
    console.log(`  ${col(tool, 34)} ${col(String(agg.count) + "×", 5)} ${agg.durationMs} ms`);
  }

  const out = arg("out") ?? `ops-trace-${planId}.json`;
  writeFileSync(out, JSON.stringify({ planId, calls, summary: s }, null, 2));
  console.log(`\nexported → ${out}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
