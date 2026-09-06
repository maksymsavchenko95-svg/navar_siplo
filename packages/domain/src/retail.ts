import { z } from "zod";

/**
 * Retail-facing contracts (the `RetailProvider` vocabulary). Kept provider-agnostic so a
 * second retailer wouldn't touch the planner/mapper/API (ADR-04).
 */

/** Cart context — the prerequisite for every catalogue/search call (rules/mcp-integration). */
export const cartContextSchema = z.object({
  branchId: z.string(),
  deliveryType: z.string(),
  timeslot: z.object({ start: z.string(), end: z.string() }),
});
export type CartContext = z.infer<typeof cartContextSchema>;

/**
 * A multi-buy price tier as Silpo returns it on a search hit — `{price: 114, count: 2,
 * type: "from"}` reads "2 or more at 114 ₴ each". Independent of `oldPrice` (the M0 audit
 * saw no product carrying both). Interpreted by `promoTier` / `effectiveUnitPrice`.
 */
export const specialPriceSchema = z.object({
  price: z.number(),
  count: z.number(),
  type: z.string(), // "from" = buy N or more; other types are ignored rather than guessed at
});
export type SpecialPrice = z.infer<typeof specialPriceSchema>;

/** One concrete SKU from a product search, trimmed for display + (later) cart add. */
export const productMatchSchema = z.object({
  productId: z.string(),
  externalProductId: z.number().nullable(),
  companyId: z.string(),
  branchId: z.string(),
  slug: z.string(),
  name: z.string(),
  price: z.number(),
  oldPrice: z.number().nullable(),
  packSize: z.string().nullable(), // Silpo `displayRatio`, e.g. "400мл"
  imageUrl: z.string().nullable(),
  inStock: z.boolean(),
  weighted: z.boolean().default(false), // priced by weight (meat / loose produce)
  step: z.number().positive().nullable().default(null), // weighing increment, kg (e.g. 0.4)
  specialPrices: z.array(specialPriceSchema).default([]), // multi-buy tiers («Гуртом дешевше»)
});
export type ProductMatch = z.infer<typeof productMatchSchema>;

/** All SKU candidates found for one search query. */
export const productSearchResultSchema = z.object({
  query: z.string(),
  products: z.array(productMatchSchema),
});
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;

/**
 * `silpo_get_product_details` for one SKU, flattened from `product.attributes`. Feeds the
 * SKU-level safety gate (T2.2) and the replacement funnel — **not** the mapper's P0
 * scoring path (composition coverage is ~22% per the M0 audit). No fibre is exposed.
 */
export const productDetailsSchema = z.object({
  slug: z.string(),
  name: z.string(),
  price: z.number(),
  oldPrice: z.number().nullable(),
  inStock: z.boolean(),
  weighted: z.boolean(),
  packSize: z.string().nullable(), // Silpo `displayRatio`
  attributes: z.record(z.union([z.string(), z.number()])), // raw key→value
  composition: z.string().nullable(), // "Склад"
  allergens: z.array(z.string()), // "Містить алергени: ГЛЮТЕН,ПШЕНИЦЯ" → ["ГЛЮТЕН","ПШЕНИЦЯ"]
  kcal100: z.number().nullable(), // parseKcal("189/801") → 189
  protein100: z.number().nullable(),
  fat100: z.number().nullable(),
  carbs100: z.number().nullable(),
});
export type ProductDetails = z.infer<typeof productDetailsSchema>;

/** `silpo_get_replacements` → one entry per requested SKU. `replacements: []` is normal. */
export const replacementResultSchema = z.object({
  productId: z.string(),
  replacements: z.array(productMatchSchema),
});
export type ReplacementResult = z.infer<typeof replacementResultSchema>;

/**
 * One recipe ingredient → the single SKU picked to buy it. `confidence` /
 * `needsConfirmation` / `packCount` / `surplusAmount` are populated by `@navar/mapper`
 * (T2.1); the defaults keep the pre-mapper naive shape valid.
 */
export const ingredientSkuCandidateSchema = z.object({
  ingredient: z.string(),
  query: z.string(),
  match: productMatchSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable().default(null),
  needsConfirmation: z.boolean().default(false),
  packCount: z.number().int().nonnegative().default(1),
  surplusAmount: z.number().nonnegative().default(0),
  /** The safety gate (T2.2) blocked this line — `match` is null, `blockReason` explains why. */
  blocked: z.boolean().default(false),
  blockReason: z.string().nullable().default(null),
});
export type IngredientSkuCandidate = z.infer<typeof ingredientSkuCandidateSchema>;

/** `recipes.skuCandidates` result — discriminated like `mcp.listTools`. */
export const recipeShoppingResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    branchId: z.string(),
    items: z.array(ingredientSkuCandidateSchema),
    totalUah: z.number(), // sum of matched prices (missing matches excluded)
    matchedCount: z.number(),
    blockedCount: z.number().default(0), // lines the safety gate blocked (T2.2)
  }),
  z.object({ status: z.literal("auth_required"), hint: z.string() }),
  z.object({ status: z.literal("no_cart"), hint: z.string() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type RecipeShoppingResult = z.infer<typeof recipeShoppingResultSchema>;

// ─── Promotions (T4.1, FR-PLAN-004) ─────────────────────────────────────────

/**
 * One active campaign group from `silpo_get_promotions`. A **campaign, not a SKU** — the
 * tool returns `{code, title, productCount, url}` and nothing about individual products or
 * discounts (M0 audit Block 5: 9 groups, `productCount` up to 2343). The promo SKUs
 * themselves come from a second call, `silpo_get_products` filtered by `code`.
 */
export const promotionSchema = z.object({
  code: z.string(), // feeds `silpo_get_products`.promotionCode
  title: z.string(),
  productCount: z.number(),
  url: z.string().nullable(),
});
export type Promotion = z.infer<typeof promotionSchema>;

/**
 * One personal offer from `silpo_get_my_promos`.
 *
 * **These are bonus multipliers, not price cuts** ("x35 балобонусів"), confirmed by the M0
 * audit. They must never enter `promo_share` or budget arithmetic — doing so would
 * overstate the Guest-facing savings number (`AC-P0-04`). They are week-scoped and
 * guest-activated, so `endDate` and `selected` are load-bearing: a weekly plan can outlast
 * an offer.
 */
export const personalPromoSchema = z.object({
  promoId: z.number(),
  selected: z.boolean(),
  beginDate: z.string().nullable(),
  endDate: z.string().nullable(),
  description: z.string().nullable(),
  rewardText: z.string().nullable(), // e.g. "x35 балобонусів" — a multiplier, not ₴
  rewardValue: z.number().nullable(),
  limitText: z.string().nullable(),
});
export type PersonalPromo = z.infer<typeof personalPromoSchema>;
