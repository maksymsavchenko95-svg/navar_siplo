import { db } from "@navar/db";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

import { getLlm, getLlmTracer } from "../llm.js";
import { getRetail } from "../retail.js";

export async function createContext(_opts: CreateFastifyContextOptions) {
  return { db, retail: await getRetail(), llm: getLlm(), tracer: getLlmTracer() };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
