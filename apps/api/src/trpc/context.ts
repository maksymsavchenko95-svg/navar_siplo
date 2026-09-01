import { db } from "@navar/db";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

import { getRetail } from "../retail.js";

export async function createContext(_opts: CreateFastifyContextOptions) {
  return { db, retail: await getRetail() };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
