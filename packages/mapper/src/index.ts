/**
 * @navar/mapper — ingredient ↔ SKU (T2.1, TDD §5, SRS §6.6, `FR-MAP-001..006`).
 *
 * Consolidate a plan's `CanonicalIngredient`s (unit conversion, deterministic) → normalise
 * each to a head-noun search query (M0 audit follow-up #1) → score the `find_products_batch`
 * candidates deterministically (ADR-02) → LLM re-rank only when the top-1/top-2 gap ≤ 0.25
 * → flag `confidence < 0.6` for the Guest, never add silently (`FR-MAP-006`). Pack-size
 * aware (`FR-MAP-003`); out-of-stock picks go through the replacement funnel (`FR-MAP-005`).
 *
 * The core is pure and dependency-injected: `mapPlan(input, { retail, rerank })`. `retail`
 * is any `RetailProvider`; `rerank` is `@navar/llm`'s `llmRerank(...)` (its deterministic
 * fallback keeps the pipeline reproducible — ADR-03). `pgvector` candidate generation is
 * dormant in P0 (no embeddings) — trigram similarity does the SKU-name scoring.
 */

export { consolidate, toBaseAmount, ConsolidationError } from "./consolidate.js";
export { buildQuery, chunkQueries, MODIFIER_STOPWORDS } from "./normalize-query.js";
export { parsePackSize, computePack, type PackPlan } from "./pack.js";
export { scoreCandidate, rankCandidates, isWrongForm, type ScoredCandidate } from "./score.js";
export { decideMatch, type Decision } from "./decide.js";
export { mapPlan, type MapPlanInput, type MapPlanDeps } from "./map.js";
export {
  loadGolden,
  evaluateQuery,
  evaluateSkuMatch,
  goldenPairSchema,
  GOLDEN_DIR,
  type GoldenPair,
  type GoldenQueryOutcome,
} from "./golden.js";
export { isNonFoodSku } from "./nonfood.js";
export {
  ACCEPT_GAP,
  MIN_CONFIDENCE,
  BATCH_SIZE,
  OVERSIZE_PACK_RATIO,
  type MapperDictEntry,
  type PlanIngredientLine,
  type MapperRetail,
  type RerankFn,
  type IngredientSafetyCheck,
  type SkuSafetyCheck,
} from "./types.js";
