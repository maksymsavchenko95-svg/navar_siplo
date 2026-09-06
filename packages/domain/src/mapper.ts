import { z } from "zod";

import { ingredientCategorySchema } from "./schemas.js";
import { productMatchSchema } from "./retail.js";
import { baseUnitSchema } from "./units.js";

/**
 * Mapper contracts (`@navar/mapper`, T2.1 — TDD §5, SRS §6.6, `FR-MAP-001..006`). The
 * mapper consolidates a plan's `CanonicalIngredient`s, normalises each to a search query,
 * scores the SKU candidates deterministically (ADR-02), re-ranks with the LLM only on a
 * close call, and flags low-confidence matches for the Guest — it never adds silently.
 */

// ── Consolidation output (FR-MAP-001) ────────────────────────────────────────

/** Identical `CanonicalIngredient`s across a plan's recipes, summed in the base unit. */
export const consolidatedIngredientSchema = z.object({
  slug: z.string(),
  nameUk: z.string(),
  category: ingredientCategorySchema,
  baseUnit: baseUnitSchema,
  amount: z.number().nonnegative(), // summed, in baseUnit
  lineCount: z.number().int().positive(),
  optionalOnly: z.boolean(), // every contributing recipe line was `optional`
});
export type ConsolidatedIngredient = z.infer<typeof consolidatedIngredientSchema>;

// ── Per-ingredient result (FR-MAP-003 / FR-MAP-006) ──────────────────────────

export const skuMatchDecisionSchema = z.enum([
  "accepted", // top1 − top2 > 0.25, took top1
  "reranked", // gap ≤ 0.25, LLM (or its deterministic fallback) chose
  "needs_confirmation", // confidence < 0.6 — flagged, never added silently
  "no_match", // search returned nothing usable
  "replacement", // chosen via the get_replacements funnel
  "blocked_unsafe", // failed the safety gate (T2.2) — fail-closed, non-overridable
]);
export type SkuMatchDecision = z.infer<typeof skuMatchDecisionSchema>;

export const skuMatchSchema = z.object({
  slug: z.string(),
  ingredientNameUk: z.string(),
  query: z.string(),
  neededAmount: z.number().nonnegative(),
  neededUnit: baseUnitSchema,
  match: productMatchSchema.nullable(),
  score: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  decision: skuMatchDecisionSchema,
  needsConfirmation: z.boolean(),
  packCount: z.number().int().nonnegative(),
  packSize: z.number().positive().nullable(), // parsed pack size, base unit
  surplusAmount: z.number().nonnegative(), // bought − needed, base unit → future pantry
  isPromo: z.boolean(),
  /**
   * The chosen SKU's multi-buy tier, when it has one (T4.1). Carried to the solver so the
   * budget maths can apply the discount only once the plan actually buys `minCount` units —
   * `isPromo` says a discount *exists*, this says what it takes to *collect* it.
   */
  promoTier: z.object({ minCount: z.number(), price: z.number() }).nullable().default(null),
  candidatesConsidered: z.number().int().nonnegative(),
  rerankSource: z.enum(["llm", "fallback"]).nullable(),
  /** True once the safety gate (T2.2) ran for this line — ingredient-level and/or SKU-level. */
  safetyChecked: z.boolean(),
  /** Guest-facing reason a line was blocked (`decision: "blocked_unsafe"`); non-medical. */
  blockReason: z.string().nullable(),
  /** The chosen SKU is out of stock and the replacement funnel found nothing (F5, `FR-MAP-005`). */
  outOfStock: z.boolean().default(false),
});
export type SkuMatch = z.infer<typeof skuMatchSchema>;

export const mapperResultSchema = z.object({
  branchId: z.string(),
  consolidated: z.array(consolidatedIngredientSchema),
  matches: z.array(skuMatchSchema),
  stats: z.object({
    total: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    needsConfirmation: z.number().int().nonnegative(),
    noMatch: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  }),
});
export type MapperResult = z.infer<typeof mapperResultSchema>;

// ── LLM step I/O: rerankSkuMatch (TDD §6) ────────────────────────────────────
// No PII in this step, so the contract lives here with the rest of the mapper vocabulary
// rather than in `household.ts`.

export const rerankSkuMatchCandidateSchema = z.object({
  name: z.string(),
  packSize: z.string().nullable(),
  price: z.number(),
  promo: z.boolean(),
  score: z.number(), // deterministic score 0..1; candidates arrive pre-sorted desc
});

export const rerankSkuMatchInputSchema = z.object({
  ingredient: z.object({
    name: z.string(),
    category: ingredientCategorySchema,
    neededQty: z.number().positive(),
    unit: baseUnitSchema,
  }),
  candidates: z.array(rerankSkuMatchCandidateSchema).min(2).max(5),
});
export type RerankSkuMatchInput = z.infer<typeof rerankSkuMatchInputSchema>;

export const rerankSkuMatchOutputSchema = z.object({
  index: z.number().int().min(0).max(4),
  confidence: z.number().min(0).max(1),
});
export type RerankSkuMatchOutput = z.infer<typeof rerankSkuMatchOutputSchema>;
