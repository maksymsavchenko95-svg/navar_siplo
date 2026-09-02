import { db } from "@navar/db";

import { getLlm, getLlmTracer } from "../llm.js";
import type { Context } from "./context.js";

/**
 * A `Context` for tests — as if the caller has a valid session for `householdId`. `req`/`res`
 * are minimal stubs (only the auth procedures touch them). Pass a fake `retail` for offline
 * tests; a real one for the integration suites.
 */
export function testContext(over: {
  householdId?: string | null;
  retail?: Context["retail"];
  sessionId?: string;
}): Context {
  const householdId = over.householdId === undefined ? "test-household" : over.householdId;
  const retail = "retail" in over ? over.retail! : householdId ? ({} as Context["retail"]) : null;
  return {
    db,
    req: { protocol: "http" } as Context["req"],
    res: {
      setCookie: () => undefined,
      clearCookie: () => undefined,
      redirect: () => undefined,
    } as unknown as Context["res"],
    sessionId: over.sessionId ?? (householdId ? "test-session" : null),
    householdId,
    retail,
    llm: getLlm(),
    tracer: getLlmTracer(),
  };
}
