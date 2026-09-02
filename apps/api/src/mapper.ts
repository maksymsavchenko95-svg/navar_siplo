import { db, schema } from "@navar/db";
import type { SkuMatch } from "@navar/domain";
import { llmRerank } from "@navar/llm";
import type { MapperDictEntry, RerankFn } from "@navar/mapper";
import { inArray } from "drizzle-orm";

import { getLlm, getLlmTracer } from "./llm.js";

/**
 * Load the dictionary rows a plan needs, in the shape `@navar/mapper` consumes. The DB row
 * is authoritative (identical to `CANONICAL_INGREDIENTS` today, but an edit lands here
 * first). Drizzle `numeric` columns come back as strings.
 */
export async function loadMapperDict(slugs: string[]): Promise<Map<string, MapperDictEntry>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({
      slug: schema.canonicalIngredients.slug,
      nameUk: schema.canonicalIngredients.nameUk,
      category: schema.canonicalIngredients.category,
      baseUnit: schema.canonicalIngredients.baseUnit,
      densityGMl: schema.canonicalIngredients.densityGMl,
      gramsPerPiece: schema.canonicalIngredients.gramsPerPiece,
      synonyms: schema.canonicalIngredients.synonyms,
    })
    .from(schema.canonicalIngredients)
    .where(inArray(schema.canonicalIngredients.slug, slugs));

  return new Map(
    rows.map((r) => [
      r.slug,
      {
        slug: r.slug,
        nameUk: r.nameUk,
        category: r.category as MapperDictEntry["category"],
        baseUnit: r.baseUnit as MapperDictEntry["baseUnit"],
        densityGMl: r.densityGMl == null ? null : Number(r.densityGMl),
        gramsPerPiece: r.gramsPerPiece == null ? null : Number(r.gramsPerPiece),
        synonyms: r.synonyms ?? [],
      },
    ]),
  );
}

/** The LLM re-rank function for the mapper's close-call branch, wired to the API singletons. */
export function getRerankFn(): RerankFn {
  return llmRerank({ provider: getLlm(), tracer: getLlmTracer() });
}

/**
 * `SkuMatch[]` → the solver's price map (`SolverInput.prices`, consumed by T2.3). Resolves
 * the `packSize: string → number` question: the mapper already parsed it; when unknown we
 * substitute the needed amount so the solver's `ceil(toBuy / packSize)` yields one pack.
 */
export function skuMatchesToPrices(
  matches: readonly SkuMatch[],
  idBySlug: ReadonlyMap<string, string>,
): Map<string, { uah: number; promo: boolean; packSize: number }> {
  const out = new Map<string, { uah: number; promo: boolean; packSize: number }>();
  for (const m of matches) {
    const id = idBySlug.get(m.slug);
    if (!id || !m.match) continue;
    out.set(id, {
      uah: m.match.price,
      promo: m.isPromo,
      packSize: m.packSize ?? m.neededAmount,
    });
  }
  return out;
}
