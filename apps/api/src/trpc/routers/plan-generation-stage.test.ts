import { describe, expect, it, vi } from "vitest";

const readGenStage = vi.fn<(hh: string) => Promise<string | null>>();
vi.mock("../../plan-progress.js", () => ({
  readGenStage: (...a: [string]) => readGenStage(...a),
  setGenStage: vi.fn(),
  clearGenStage: vi.fn(),
}));

const { appRouter } = await import("../router.js");
const { testContext } = await import("../test-context.js");

const ctx = () => testContext({ householdId: "hh-1", retail: {} as never, sessionId: "s" });

describe("plan.generationStage", () => {
  it("returns the household's current stage", async () => {
    readGenStage.mockResolvedValueOnce("solving");
    expect(await appRouter.createCaller(ctx()).plan.generationStage()).toEqual({
      stage: "solving",
    });
    expect(readGenStage).toHaveBeenCalledWith("hh-1");
  });

  it("returns null when nothing is generating", async () => {
    readGenStage.mockResolvedValueOnce(null);
    expect(await appRouter.createCaller(ctx()).plan.generationStage()).toEqual({ stage: null });
  });

  it("is protected — no session → UNAUTHORIZED", async () => {
    await expect(
      appRouter.createCaller(testContext({ householdId: null })).plan.generationStage(),
    ).rejects.toThrow(/UNAUTHORIZED|Not connected/);
  });
});
