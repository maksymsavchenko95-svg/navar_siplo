/**
 * Backfill `canonical_ingredients.embedding` (pgvector, 1536-dim, HNSW index already in
 * place). Deferred for M1 (roadmap T1.2 decision): the project is Anthropic-only and has
 * no embeddings provider, and the mapper (T2.1) runs on `pg_trgm` + `synonyms` for now.
 *
 * This stub is the seam. To turn embeddings on:
 *  1. add an embeddings provider (e.g. OpenAI `text-embedding-3-small` → 1536 dims, no
 *     migration needed) gated on its own API key;
 *  2. embed `nameUk + " " + synonyms.join(" ")` per row;
 *  3. `UPDATE canonical_ingredients SET embedding = $1 WHERE slug = $2`.
 */

import { closeDb } from "./client.js";

export async function embedCanonicalIngredients(): Promise<void> {
  console.log(
    "[embed:ingredients] embeddings are deferred for M1 (roadmap T1.2). " +
      "No embeddings provider is wired; the mapper uses pg_trgm + synonyms. Nothing to do.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  embedCanonicalIngredients()
    .then(closeDb)
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
