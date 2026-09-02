import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Requires a system session (`FR-AUTH-002`). Narrows `ctx.householdId` / `ctx.retail` to
 * non-null for the procedure body.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.householdId || !ctx.retail) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not connected to Silpo" });
  }
  return next({ ctx: { ...ctx, householdId: ctx.householdId, retail: ctx.retail } });
});
