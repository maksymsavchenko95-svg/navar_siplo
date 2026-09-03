import type { CartMaterializeResult, CartPreviewResult } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

// ── mock the cart service so this is a pure wiring test ──────────────────────

const previewPlan = vi.fn<() => Promise<CartPreviewResult>>();
const materializePlan = vi.fn<() => Promise<CartMaterializeResult>>();
const armPreview = vi.fn(async () => undefined);
const checkoutLink = vi.fn();
const offerBonus = vi.fn();
const applyBonus = vi.fn();

vi.mock("../../cart.js", () => ({
  previewPlan: (...a: unknown[]) => previewPlan(...(a as [])),
  materializePlan: (...a: unknown[]) => materializePlan(...(a as [])),
  armPreview: (...a: unknown[]) => armPreview(...(a as [])),
  checkoutLink: (...a: unknown[]) => checkoutLink(...(a as [])),
  offerBonus: (...a: unknown[]) => offerBonus(...(a as [])),
  applyBonus: (...a: unknown[]) => applyBonus(...(a as [])),
}));

const { appRouter } = await import("../router.js");
const { testContext } = await import("../test-context.js");

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const ctx = () => testContext({ householdId: "hh-1", retail: {} as never, sessionId: "sess-9" });

describe("cart router", () => {
  it("preview arms the session guard only on an ok result", async () => {
    previewPlan.mockResolvedValueOnce({ status: "not_found" });
    await appRouter.createCaller(ctx()).cart.preview({ planId: PLAN_ID });
    expect(armPreview).not.toHaveBeenCalled();

    previewPlan.mockResolvedValueOnce({
      status: "ok",
      planId: PLAN_ID,
      addable: [],
      needsConfirmation: [],
      blocked: [],
      outOfStock: [],
      unmatched: [],
      estimatedAddUah: 0,
      currentCartLines: 0,
      alreadyMaterialized: false,
    });
    await appRouter.createCaller(ctx()).cart.preview({ planId: PLAN_ID });
    expect(armPreview).toHaveBeenCalledWith("sess-9", PLAN_ID);
  });

  it("materialize forwards the session id + confirmed lines to the service", async () => {
    materializePlan.mockResolvedValue({ status: "needs_preview" });
    await appRouter
      .createCaller(ctx())
      .cart.materialize({ planId: PLAN_ID, confirmedLines: ["cream"] });
    expect(materializePlan).toHaveBeenCalledWith(PLAN_ID, "hh-1", expect.anything(), {
      sessionId: "sess-9",
      confirmedLines: ["cream"],
    });
  });

  it("every procedure is protected — no session → UNAUTHORIZED", async () => {
    const anon = testContext({ householdId: null });
    await expect(appRouter.createCaller(anon).cart.preview({ planId: PLAN_ID })).rejects.toThrow(
      /UNAUTHORIZED|Not connected/,
    );
  });
});
