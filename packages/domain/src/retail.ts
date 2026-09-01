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
});
export type ProductMatch = z.infer<typeof productMatchSchema>;

/** All SKU candidates found for one search query. */
export const productSearchResultSchema = z.object({
  query: z.string(),
  products: z.array(productMatchSchema),
});
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;

/** One recipe ingredient → the single SKU picked to buy it (naive first-match, P0). */
export const ingredientSkuCandidateSchema = z.object({
  ingredient: z.string(),
  query: z.string(),
  match: productMatchSchema.nullable(),
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
