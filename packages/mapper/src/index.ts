/**
 * @navar/mapper — ingredient ↔ SKU. Consolidate the plan's ingredients (unit conversion
 * via density, `@navar/domain`), then match each to a concrete Silpo SKU: lexical
 * (pg_trgm) + vector (pgvector) candidates → deterministic scoring → LLM re-rank only
 * when the top-1/top-2 gap is small. Respect pack sizes; low-confidence matches are
 * flagged for the guest, never added silently. Replacements go through the same funnel.
 *
 * Spec: TDD §5, SRS §6.6. Consolidation and conversion are deterministic (ADR-02).
 */

export function mapIngredientsToSkus(): never {
  throw new Error("mapper not implemented — P0 (TDD §5)");
}
