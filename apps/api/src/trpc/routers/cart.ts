import type {
  CartApplyBonusResult,
  CartBonusOfferResult,
  CartCheckoutLinkResult,
  CartMaterializeResult,
  CartPreviewResult,
} from "@navar/domain";
import { z } from "zod";

import {
  applyBonus,
  armPreview,
  checkoutLink,
  materializePlan,
  offerBonus,
  previewPlan,
} from "../../cart.js";
import { protectedProcedure, router } from "../trpc.js";

/**
 * `cart.*` (roadmap T3.1 / T3.2, TDD §7). `preview` → the Guest sees what will be added →
 * an explicit `materialize` call (guarded: only valid after a `preview` in this session)
 * writes to the Silpo cart, re-reads it, and returns `validations[]` + the checkout link.
 * `offerBonus` / `applyBonus` are balabonuses — applied only on an explicit `applyBonus`
 * call (`FR-CART-006`). Every procedure is account-scoped (`ctx.householdId` / `ctx.retail`).
 */
export const cartRouter = router({
  preview: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .mutation(async ({ ctx, input }): Promise<CartPreviewResult> => {
      const result = await previewPlan(input.planId, ctx.householdId, ctx.retail);
      if (result.status === "ok") await armPreview(ctx.sessionId, input.planId);
      return result;
    }),

  materialize: protectedProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        confirmedLines: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<CartMaterializeResult> => {
      return materializePlan(input.planId, ctx.householdId, ctx.retail, {
        sessionId: ctx.sessionId,
        confirmedLines: input.confirmedLines,
      });
    }),

  checkoutLink: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<CartCheckoutLinkResult> => {
      return checkoutLink(input.planId, ctx.householdId, ctx.retail);
    }),

  offerBonus: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<CartBonusOfferResult> => {
      return offerBonus(input.planId, ctx.householdId, ctx.retail);
    }),

  applyBonus: protectedProcedure
    .input(z.object({ planId: z.string().uuid(), amount: z.number().nonnegative().nullable() }))
    .mutation(async ({ ctx, input }): Promise<CartApplyBonusResult> => {
      return applyBonus(input.planId, ctx.householdId, ctx.retail, input.amount);
    }),
});
