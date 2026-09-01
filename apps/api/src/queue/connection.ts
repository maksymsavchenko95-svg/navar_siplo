import { Redis } from "ioredis";

import { env } from "../env.js";

/**
 * Shared Redis connection for BullMQ (T1.4). `maxRetriesPerRequest: null` is required by
 * BullMQ workers. `lazyConnect` so importing a queue module in a test (or before Redis is
 * up) doesn't open a socket — BullMQ connects on first use.
 */
export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
