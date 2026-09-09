import { z } from "zod";

import { skuMatchDecisionSchema } from "./mapper.js";

/**
 * Cart-materialisation contracts (roadmap T3.1 / T3.2 — TDD §7/§8, `FR-CART-001..007`,
 * ADR-07). `@navar/retail` reads the live Silpo cart into `CartView`; `apps/api`'s cart
 * service turns a persisted plan's `list_lines` into a preview, writes the addable lines,
 * re-reads the cart, and surfaces `validations[]` + the checkout link. Balabonuses (T3.2)
 * ride on the same `CartView` (`loyalty` is a sibling field in the Silpo response).
 *
 * Deterministic, never the LLM (ADR-02). All results are discriminated unions on `status`,
 * mirroring `planGenerateResultSchema`.
 */

// ── live cart read (`silpo_get_shopping_cart_by_id`) ─────────────────────────

/** One `cart.calculation.validations[]` entry — a stable machine code + structured context. */
export const cartValidationSchema = z.object({
  level: z.enum(["error", "info"]),
  type: z.string(),
  message: z.string(), // e.g. "order.cost.min", "product.offer.stock.max", "timeslot.not_found"
  context: z.record(z.unknown()).optional(),
});
export type CartValidation = z.infer<typeof cartValidationSchema>;

/** Top-level `loyalty` block — balabonuses (`FR-CART-006`). Sibling of `cart`, not nested. */
export const cartLoyaltySchema = z.object({
  bonusAvailable: z.number(),
  bonusTotal: z.number(),
  bonusRequested: z.number().nullable(),
  isEnabled: z.boolean(),
});
export type CartLoyalty = z.infer<typeof cartLoyaltySchema>;

/** One product line already in the cart (`cart.shipments[].products[]`). */
export const cartLineSchema = z.object({
  productId: z.string(),
  name: z.string().nullable(),
  quantity: z.number(),
  price: z.number().nullable(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

/**
 * The delivery fields `silpo_update_shopping_cart` must echo back verbatim (T3.2 —
 * applying balabonuses goes through that tool). `address` is opaque: copy it as received,
 * never reconstruct it (it must carry `addressType` / `latitude` / `longitude`).
 */
export const cartDeliveryEchoSchema = z.object({
  deliveryType: z.string(),
  timeslot: z.object({ start: z.string(), end: z.string() }),
  address: z.record(z.unknown()),
  shipments: z.array(z.object({ companyId: z.string(), branchId: z.string() })),
});
export type CartDeliveryEcho = z.infer<typeof cartDeliveryEchoSchema>;

/** The whole live cart, parsed from `silpo_get_my_shopping_cart` + `..._by_id`. */
export const cartViewSchema = z.object({
  shoppingCartId: z.string(),
  lines: z.array(cartLineSchema),
  totalUah: z.number().nullable(), // cart.calculation.total (pre-discount)
  totalAfterDiscountsUah: z.number().nullable(), // the amount actually paid — show this one
  validations: z.array(cartValidationSchema),
  loyalty: cartLoyaltySchema.nullable(),
  checkoutWebLink: z.string().nullable(), // emitted only when the cart passes validation
  checkoutMobileLink: z.string().nullable(),
  delivery: cartDeliveryEchoSchema.nullable(),
});
export type CartView = z.infer<typeof cartViewSchema>;

// ── cart writes ─────────────────────────────────────────────────────────────

/** One SKU to add — every id comes straight from a `list_lines` row / product search. */
export const cartWriteItemSchema = z.object({
  productId: z.string(),
  companyId: z.string(),
  branchId: z.string(),
  quantity: z.number().positive(),
});
export type CartWriteItem = z.infer<typeof cartWriteItemSchema>;

/** `silpo_add_or_update_cart_products` / `..._remove` payload — acceptance, not validity. */
export const cartWriteResultSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  products: z.array(z.object({ productId: z.string(), quantity: z.number().optional() })),
});
export type CartWriteResult = z.infer<typeof cartWriteResultSchema>;

// ── preview / materialize (the `cart.*` tRPC procedures) ─────────────────────

/** A shopping-list line as shown to the Guest before the cart write. Built from `ListLine`. */
export const cartPreviewLineSchema = z.object({
  slug: z.string(),
  nameUk: z.string(),
  productName: z.string().nullable(),
  productRef: z.string().nullable(),
  quantity: z.number().int().nonnegative(), // packCount
  /** Kilograms for a weighted line («0.3 кг»); `null` → packaged, show `quantity` packs. */
  quantityKg: z.number().positive().nullable().default(null),
  priceUah: z.number().nullable(),
  isPromo: z.boolean(),
  decision: skuMatchDecisionSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  blockReason: z.string().nullable(),
  /** For a `replacement` row — the out-of-stock SKU it stands in for. */
  replacedFromName: z.string().nullable(),
  /** The Guest picked this SKU by hand on the preview screen (`cart.setLineSku`). */
  userOverridden: z.boolean().default(false),
  /** A meat/fish line whose fresh form the branch does not stock — offer a meal swap. */
  proteinUnavailable: z.boolean().default(false),
  /** Plan days that cook with this ingredient (for the «Замінити страву» action). */
  affectedDays: z.array(z.number().int().positive()).default([]),
});
export type CartPreviewLine = z.infer<typeof cartPreviewLineSchema>;

// ── per-line SKU swap (`cart.lineAlternatives` / `cart.setLineSku`) ──────────

/** One alternative SKU for a shopping-list line, priced for the line's needed amount. */
export const cartLineAlternativeSchema = z.object({
  productId: z.string(),
  companyId: z.string(),
  branchId: z.string(),
  name: z.string(),
  priceUah: z.number(),
  packSizeLabel: z.string().nullable(), // Silpo `displayRatio`
  packCount: z.number().int().positive(),
  /** Kilograms for a weighted alternative; `null` for packaged goods. */
  quantityKg: z.number().positive().nullable().default(null),
  lineTotalUah: z.number(), // price × (quantityKg ?? packCount)
  isPromo: z.boolean(),
  inStock: z.boolean(),
  weighted: z.boolean(),
  isCurrent: z.boolean(), // the SKU the line currently uses
});
export type CartLineAlternative = z.infer<typeof cartLineAlternativeSchema>;

export const cartLineAlternativesResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    slug: z.string(),
    nameUk: z.string(),
    alternatives: z.array(cartLineAlternativeSchema),
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CartLineAlternativesResult = z.infer<typeof cartLineAlternativesResultSchema>;

export const cartSetLineSkuResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok") }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("already_materialized"), reason: z.string() }),
  z.object({ status: z.literal("rejected"), reason: z.string() }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CartSetLineSkuResult = z.infer<typeof cartSetLineSkuResultSchema>;

/**
 * `cart.preview(planId)` — exactly what a `cart.materialize` would add, partitioned so the
 * Guest sees what is blocked / needs confirmation / is out of stock before anything is
 * written (`FR-CART-001`, ADR-07). Trusts the stored `list_lines` prices; the real total
 * comes back from `cart.materialize`.
 */
export const cartPreviewResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    planId: z.string().uuid(),
    addable: z.array(cartPreviewLineSchema),
    needsConfirmation: z.array(cartPreviewLineSchema),
    blocked: z.array(cartPreviewLineSchema),
    outOfStock: z.array(cartPreviewLineSchema),
    unmatched: z.array(cartPreviewLineSchema),
    estimatedAddUah: z.number().nonnegative(),
    currentCartLines: z.number().int().nonnegative(),
    alreadyMaterialized: z.boolean(),
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CartPreviewResult = z.infer<typeof cartPreviewResultSchema>;

/** A line `cart.materialize` did not add, with a Guest-facing reason (non-medical). */
export const cartSkippedLineSchema = z.object({
  slug: z.string(),
  nameUk: z.string(),
  reason: z.string(),
});
export type CartSkippedLine = z.infer<typeof cartSkippedLineSchema>;

/**
 * `cart.materialize(planId)` — the single MCP write path (`INT-MCP-003`). Idempotent on
 * `planId` (Silpo cart writes are set-semantics); valid only after a `cart.preview` in the
 * same session (`needs_preview` otherwise). Re-reads the cart, so `validations` /
 * `cartTotalUah` / the links are the live truth (`FR-CART-005`).
 */
export const cartMaterializeResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    planId: z.string().uuid(),
    addedCount: z.number().int().nonnegative(),
    skipped: z.array(cartSkippedLineSchema),
    validations: z.array(cartValidationSchema),
    checkoutWebLink: z.string().nullable(),
    checkoutMobileLink: z.string().nullable(),
    cartTotalUah: z.number().nullable(),
    planEstimateUah: z.number().nullable(),
    /** `NFR-DATA-003` — plan total vs actual cart total, ≤3%. `null` when not comparable. */
    totalsWithinTolerance: z.boolean().nullable(),
  }),
  z.object({ status: z.literal("needs_preview") }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CartMaterializeResult = z.infer<typeof cartMaterializeResultSchema>;

/** `cart.checkoutLink(planId)` — the handover links, or why they aren't available yet. */
export const cartCheckoutLinkResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    webLink: z.string().nullable(),
    mobileLink: z.string().nullable(),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CartCheckoutLinkResult = z.infer<typeof cartCheckoutLinkResultSchema>;

// ── balabonuses (T3.2, `FR-CART-006`) ───────────────────────────────────────

/** `cart.offerBonus(planId)` — how many balabonuses are available on the current cart. */
export const cartBonusOfferResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    available: z.number().nonnegative(),
    bonusTotal: z.number().nonnegative(),
    isEnabled: z.boolean(),
    alreadyApplied: z.number().nullable(), // loyalty.bonusRequested
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CartBonusOfferResult = z.infer<typeof cartBonusOfferResultSchema>;

/** `cart.applyBonus(planId, amount)` — apply (`amount`) or clear (`null`) balabonuses. */
export const cartApplyBonusResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    bonusApplied: z.number(),
    cartTotalAfterDiscountsUah: z.number().nullable(),
    checkoutWebLink: z.string().nullable(),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("auth_required"), hint: z.string().optional() }),
  z.object({ status: z.literal("no_cart"), hint: z.string().optional() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CartApplyBonusResult = z.infer<typeof cartApplyBonusResultSchema>;
