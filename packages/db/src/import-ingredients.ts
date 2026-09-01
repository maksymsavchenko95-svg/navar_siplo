/**
 * Idempotent importer for the `CanonicalIngredient` dictionary (roadmap T1.2).
 *
 * Upserts every entry from `data/canonical-ingredients.ts` keyed on `slug`. Re-running is a
 * no-op on row count and converges any hand-edited row back to the data file. It never
 * truncates — `recipe_ingredients.ingredient_id` is `ON DELETE restrict` (and
 * `receipt_lines` will be too), so a truncate would fail once recipes exist.
 *
 * `embedding` is deliberately left untouched (deferred — see `embed-ingredients.ts`).
 *
 * Run: `pnpm db:import:ingredients`. Also called at the top of `seed.ts`.
 */

import { canonicalIngredientSchema, type CanonicalIngredientSeed } from "@navar/domain";
import { sql } from "drizzle-orm";

import { closeDb, db, type Db } from "./client.js";
import { CANONICAL_INGREDIENTS } from "./data/canonical-ingredients.js";
import { canonicalIngredients } from "./schema.js";

/** numeric → string with 2 dp (matches the seed's `n()` helper), or null passthrough. */
function num(v: number | null | undefined): string | null {
  return v == null ? null : v.toFixed(2);
}

/** One validated dictionary entry → the drizzle insert row (no `embedding`). */
export function toRow(e: CanonicalIngredientSeed) {
  return {
    slug: e.slug,
    nameUk: e.nameUk,
    category: e.category,
    baseUnit: e.baseUnit,
    densityGMl: e.densityGMl == null ? null : e.densityGMl.toFixed(3),
    gramsPerPiece: num(e.gramsPerPiece),
    allergens: e.allergens,
    synonyms: e.synonyms,
    perishableDays: e.perishableDays,
    kcal100: num(e.per100g?.kcal),
    protein100: num(e.per100g?.protein),
    fat100: num(e.per100g?.fat),
    carbs100: num(e.per100g?.carbs),
    fiber100: num(e.per100g?.fiber),
    nutritionSrc: e.nutritionSrc,
  };
}

/** Throws if two entries share a slug — a data-file authoring mistake. */
export function assertUniqueSlugs(entries: { slug: string }[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.slug)) throw new Error(`duplicate ingredient slug: ${e.slug}`);
    seen.add(e.slug);
  }
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export async function importCanonicalIngredients(
  database: Db = db,
): Promise<{ total: number; inserted: number; updated: number }> {
  // Fail closed on bad data — a malformed entry aborts the whole import.
  const entries = CANONICAL_INGREDIENTS.map((e) => canonicalIngredientSchema.parse(e));
  assertUniqueSlugs(entries);

  let inserted = 0;
  for (const part of chunk(entries, 100)) {
    const rows = await database
      .insert(canonicalIngredients)
      .values(part.map(toRow))
      .onConflictDoUpdate({
        target: canonicalIngredients.slug,
        set: {
          nameUk: sql`excluded.name_uk`,
          category: sql`excluded.category`,
          baseUnit: sql`excluded.base_unit`,
          densityGMl: sql`excluded.density_g_ml`,
          gramsPerPiece: sql`excluded.grams_per_piece`,
          allergens: sql`excluded.allergens`,
          synonyms: sql`excluded.synonyms`,
          perishableDays: sql`excluded.perishable_days`,
          kcal100: sql`excluded.kcal_100`,
          protein100: sql`excluded.protein_100`,
          fat100: sql`excluded.fat_100`,
          carbs100: sql`excluded.carbs_100`,
          fiber100: sql`excluded.fiber_100`,
          nutritionSrc: sql`excluded.nutrition_src`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    inserted += rows.filter((r) => r.inserted).length;
  }

  return { total: entries.length, inserted, updated: entries.length - inserted };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importCanonicalIngredients()
    .then(({ total, inserted, updated }) => {
      console.log(
        `[import:ingredients] ${total} entries — ${inserted} inserted, ${updated} updated`,
      );
    })
    .then(closeDb)
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
