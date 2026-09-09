import { db } from "@navar/db";
import { Worker } from "bullmq";

import { getLlm, getLlmTracer } from "../llm.js";
import { getRetail } from "../retail.js";
import { runBootstrapJob } from "./bootstrap-handler.js";
import { BOOTSTRAP_QUEUE, type BootstrapJobData } from "./bootstrap-queue.js";
import { connection } from "./connection.js";

/**
 * In-process BullMQ worker for `household.bootstrap` (T1.4). Started from `index.ts` after
 * the HTTP server is up and closed in the shutdown handler. Thin — the orchestration lives
 * in `runBootstrapJob` / `runBootstrap`, both pure of BullMQ and tested directly.
 *
 * Extract to its own compose service if job volume or a slow job starves the API event loop.
 */
export function startBootstrapWorker(): Worker<BootstrapJobData> {
  const worker = new Worker<BootstrapJobData>(
    BOOTSTRAP_QUEUE,
    (job) =>
      runBootstrapJob(job.data.householdId, {
        getProvider: getRetail,
        getLlm,
        getLlmTracer,
        db,
      }),
    { connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] bootstrap ${job?.data.householdId} failed:`, err.message);
  });

  return worker;
}
