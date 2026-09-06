import { db } from "@navar/db";
import { runWithMcpTrace } from "@navar/retail";
import { Worker } from "bullmq";

import { runBootstrap } from "../household/bootstrap-job.js";
import { getLlm, getLlmTracer } from "../llm.js";
import { persistMcpTrace } from "../mcp-trace.js";
import { getSilpoProvider } from "../retail.js";
import { BOOTSTRAP_QUEUE, type BootstrapJobData } from "./bootstrap-queue.js";
import { connection } from "./connection.js";

/**
 * In-process BullMQ worker for `household.bootstrap` (T1.4). Started from `index.ts` after
 * the HTTP server is up and closed in the shutdown handler. Thin — the orchestration lives
 * in `runBootstrap`, which is pure of BullMQ and tested directly.
 *
 * Extract to its own compose service if job volume or a slow job starves the API event loop.
 */
export function startBootstrapWorker(): Worker<BootstrapJobData> {
  const worker = new Worker<BootstrapJobData>(
    BOOTSTRAP_QUEUE,
    async (job) => {
      const provider = await getSilpoProvider();
      const { householdId } = job.data;
      const { result, records } = await runWithMcpTrace({ phase: "bootstrap" }, () =>
        runBootstrap(householdId, {
          reader: provider,
          llm: getLlm(),
          tracer: getLlmTracer(),
          db,
          now: () => new Date(),
        }),
      );
      await persistMcpTrace(records, { householdId, phase: "bootstrap" });
      return result;
    },
    { connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] bootstrap ${job?.data.householdId} failed:`, err.message);
  });

  return worker;
}
