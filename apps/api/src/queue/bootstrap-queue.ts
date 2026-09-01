import { Queue } from "bullmq";

import { connection } from "./connection.js";

export interface BootstrapJobData {
  householdId: string;
}

export const BOOTSTRAP_QUEUE = "household-bootstrap";

/**
 * `household.bootstrap` job queue (T1.4). Lazily constructed so importing this module in a
 * test (or before Redis is up) does not open a socket. `household.bootstrap` enqueues with
 * `jobId: householdId` so a re-enqueue while one runs is a no-op (idempotency guard);
 * `household.bootstrapStatus` reads `households.bootstrap_status` for the result.
 */
let queue: Queue<BootstrapJobData> | undefined;

export function bootstrapQueue(): Queue<BootstrapJobData> {
  if (!queue) queue = new Queue<BootstrapJobData>(BOOTSTRAP_QUEUE, { connection });
  return queue;
}

export async function closeBootstrapQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
