import type {
  BaseUnit,
  IngredientCategory,
  ProductMatch,
  ProductSearchResult,
  RerankSkuMatchInput,
  ReplacementResult,
  Unit,
} from "@navar/domain";

/**
 * The dictionary fields the mapper needs — a structural subset of a `canonical_ingredients`
 * row / `CanonicalIngredientSeed`. Injected by the caller (`apps/api` loads it from the
 * DB) so the mapper core stays free of `@navar/db`.
 */
export interface MapperDictEntry {
  slug: string;
  nameUk: string;
  category: IngredientCategory;
  baseUnit: BaseUnit;
  densityGMl: number | null;
  gramsPerPiece: number | null;
  synonyms: string[];
  /** EU-14 allergen codes (`canonical_ingredients.allergens`) — the ingredient-level gate (T2.2). */
  allergens: string[];
}

/** One recipe line of the plan, already scaled to the household's servings by the caller. */
export interface PlanIngredientLine {
  slug: string;
  amount: number;
  unit: Unit; // "g" | "ml" | "pcs" | "kg" | "l"
  optional?: boolean;
}

/**
 * The retail seam the mapper needs — `RetailProvider` satisfies it structurally. Kept local
 * so `@navar/mapper` depends on `@navar/domain` only (no `@navar/retail`).
 */
export interface MapperRetail {
  findProducts(queries: string[]): Promise<ProductSearchResult[]>;
  getReplacements(items: { productId: string; companyId: string }[]): Promise<ReplacementResult[]>;
}

/** The LLM re-rank seam. The deterministic fallback lives behind this too — it never throws. */
export type RerankFn = (
  input: RerankSkuMatchInput,
) => Promise<{ index: number; confidence: number; source: "llm" | "fallback" }>;

/**
 * The safety seams (T2.2). `apps/api` composes both from `@navar/safety` +
 * `retail.getProductDetails`, so `@navar/mapper` imports neither and holds no allergen
 * logic — it only coordinates. Both must be fail-closed (ADR-05) and never throw.
 *
 * `ingredientSafety` runs before search (a blocked ingredient is never queried);
 * `skuSafety` runs after the SKU is chosen (and again for a replacement — `FR-SAFE-004`).
 */
export type IngredientSafetyCheck = (entry: MapperDictEntry) => {
  blocked: boolean;
  reason: string | null;
};

export type SkuSafetyCheck = (args: {
  slug: string;
  category: string;
  ingredientAllergens: readonly string[];
  chosen: ProductMatch;
}) => Promise<{ blocked: boolean; reason: string | null }>;

/** Accept the top match outright when it leads the runner-up by more than this (TDD §5 step 4). */
export const ACCEPT_GAP = 0.25;
/** Below this confidence a match is flagged for the Guest and never added silently (`FR-MAP-006`). */
export const MIN_CONFIDENCE = 0.6;
/** `silpo_find_products_batch` takes at most this many queries per call (`FR-MAP-004`). */
export const BATCH_SIZE = 30;
/** A pack more than this multiple of what's needed is treated as a poor fit (TDD §5 step 3). */
export const OVERSIZE_PACK_RATIO = 3;
