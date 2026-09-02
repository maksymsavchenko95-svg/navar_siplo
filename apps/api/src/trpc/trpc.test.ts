import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { testContext } from "./test-context.js";
import { protectedProcedure, router } from "./trpc.js";

const probe = router({
  who: protectedProcedure.query(({ ctx }) => ctx.householdId),
});

describe("protectedProcedure", () => {
  it("rejects a context with no session", async () => {
    const caller = probe.createCaller(testContext({ householdId: null }));
    await expect(caller.who()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("passes a non-null householdId through", async () => {
    const caller = probe.createCaller(testContext({ householdId: "hh-1", retail: {} as never }));
    expect(await caller.who()).toBe("hh-1");
  });

  it("also rejects when retail is null", async () => {
    const caller = probe.createCaller(testContext({ householdId: "hh-1", retail: null }));
    await expect(caller.who()).rejects.toBeInstanceOf(TRPCError);
  });
});
