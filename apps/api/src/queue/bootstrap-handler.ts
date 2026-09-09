import type { Db } from "@navar/db";
import type { LlmProvider, LlmTracer } from "@navar/llm";
import { runWithMcpTrace } from "@navar/retail";

import {
  type BootstrapReader,
  type BootstrapResult,
  runBootstrap as runBootstrapImpl,
} from "../household/bootstrap-job.js";
import { persistMcpTrace } from "../mcp-trace.js";

/**
 * The `household-bootstrap` job body, pure of BullMQ so it unit-tests without a queue
 * (pattern: `apps/api/src/scripts/audit-util.ts`). The BullMQ wiring lives in `worker.ts`.
 *
 * The provider is resolved **per job household** (`getProvider(householdId)`) — never a
 * process-wide "current household". Using the CLI `getSilpoProvider()` helper here made
 * every web login's bootstrap run against the demo / oldest `households` row, whose token
 * is absent → `listTools()` → `auth_required` written onto the real household.
 */
export interface BootstrapJobDeps {
  getProvider: (householdId: string) => BootstrapReader;
  getLlm: () => LlmProvider;
  getLlmTracer: () => LlmTracer;
  db: Db;
  now?: () => Date;
  /** Test seam. */
  runBootstrap?: typeof runBootstrapImpl;
  /** Test seam. */
  persistTrace?: typeof persistMcpTrace;
}

export async function runBootstrapJob(
  householdId: string,
  deps: BootstrapJobDeps,
): Promise<BootstrapResult> {
  const run = deps.runBootstrap ?? runBootstrapImpl;
  const persist = deps.persistTrace ?? persistMcpTrace;
  const { result, records } = await runWithMcpTrace({ phase: "bootstrap" }, () =>
    run(householdId, {
      reader: deps.getProvider(householdId),
      llm: deps.getLlm(),
      tracer: deps.getLlmTracer(),
      db: deps.db,
      now: deps.now ?? (() => new Date()),
    }),
  );
  await persist(records, { householdId, phase: "bootstrap" });
  return result;
}
