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
  }),
  z.object({ status: z.literal("auth_required"), hint: z.string() }),
  z.object({ status: z.literal("no_cart"), hint: z.string() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type RecipeShoppingResult = z.infer<typeof recipeShoppingResultSchema>;
