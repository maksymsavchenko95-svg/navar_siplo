/// <reference types="@fastify/cookie" />
import { db } from "@navar/db";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

import { getLlm, getLlmTracer } from "../llm.js";
import { getRetail } from "../retail.js";
import { sessions } from "../session.js";

export const SESSION_COOKIE = "navar_sid";

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  const sid = req.cookies?.[SESSION_COOKIE];
  const session = await sessions.get(sid);
  const householdId = session?.householdId ?? null;

  return {
    db,
    req,
    res,
    sessionId: sid ?? null,
    householdId,
    retail: householdId ? getRetail(householdId) : null,
    llm: getLlm(),
    tracer: getLlmTracer(),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
