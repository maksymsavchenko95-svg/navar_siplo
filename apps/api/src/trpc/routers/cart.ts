import type {
  CartApplyBonusResult,
  CartBonusOfferResult,
  CartCheckoutLinkResult,
  CartDeliverySlotsResult,
  CartLineAlternativesResult,
  CartMaterializeResult,
  CartPreviewResult,
  CartSetDeliverySlotResult,
  CartSetLineSkuResult,
} from "@navar/domain";
import { z } from "zod";

import {
  applyBonus,
  armPreview,
  checkoutLink,
  deliverySlots,
  materializePlan,
  offerBonus,
  previewPlan,
  setDeliverySlot,
} from "../../cart.js";
import { lineAlternatives, setLineSku } from "../../cart-edit.js";
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
        excludeSlugs: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<CartMaterializeResult> => {
      return materializePlan(input.planId, ctx.householdId, ctx.retail, {
        sessionId: ctx.sessionId,
        confirmedLines: input.confirmedLines,
        excludeSlugs: input.excludeSlugs,
      });
    }),

  /** `cart.lineAlternatives(planId, slug)` — the branch's other SKUs for one list line. */
  lineAlternatives: protectedProcedure
    .input(z.object({ planId: z.string().uuid(), slug: z.string() }))
    .query(async ({ ctx, input }): Promise<CartLineAlternativesResult> => {
      return lineAlternatives(input.planId, ctx.householdId, input.slug, ctx.retail);
    }),

  /** `cart.setLineSku(planId, slug, productId)` — swap one line's SKU (pre-materialize). */
  setLineSku: protectedProcedure
    .input(z.object({ planId: z.string().uuid(), slug: z.string(), productId: z.string() }))
    .mutation(async ({ ctx, input }): Promise<CartSetLineSkuResult> => {
      return setLineSku(input.planId, ctx.householdId, input.slug, input.productId, ctx.retail);
    }),

  checkoutLink: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<CartCheckoutLinkResult> => {
      return checkoutLink(input.planId, ctx.householdId, ctx.retail);
    }),

  /** `cart.deliverySlots(planId)` — the branch's upcoming delivery windows (read-only). */
  deliverySlots: protectedProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<CartDeliverySlotsResult> => {
      return deliverySlots(input.planId, ctx.householdId, ctx.retail);
    }),

  /** `cart.setDeliverySlot(planId, slot)` — write the chosen window to the Silpo cart. */
  setDeliverySlot: protectedProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        slot: z.object({ start: z.string().min(1), end: z.string().min(1) }),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<CartSetDeliverySlotResult> => {
      return setDeliverySlot(input.planId, ctx.householdId, ctx.retail, input.slot);
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
