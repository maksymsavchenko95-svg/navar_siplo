/**
 * Idempotent importer for the recipe corpus (roadmap T1.3, `FR-RECIPE-001..005`, TDD §2/§3).
 *
 * Reads every `data/recipes/*.yaml` (corpus lives in git — PR review + CI validation;
 * "import into the DB is a build step"), validates each against `recipeSeedSchema`, then
 * **computes** the allergen union and per-serving macros from the `CanonicalIngredient`
 * dictionary — never hand-set (`FR-RECIPE-003`, `.claude/rules/food-safety.md`). Upserts on
 * `recipes.slug` and prunes rows whose slug left the corpus. Re-running converges any
 * hand-edited row back to the YAML; it never truncates.
 *
 * Fail-closed: a malformed YAML file, an unknown ingredient slug, or an ingredient without
 * macros aborts the whole import with a message naming the file — nothing is written.
 *
 * Run: `pnpm db:import:recipes`. Also called from `seed.ts` (after the ingredient import).
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  canonicalIngredientSchema,
  convert,
  type CanonicalIngredientSeed,
  type Macros,
  recipeMacros,
  type RecipeSeed,
  recipeSeedSchema,
  type Unit,
} from "@navar/domain";
import { eq, notInArray, sql } from "drizzle-orm";
import { parse as parseYaml } from "yaml";

import { closeDb, db, type Db } from "./client.js";
import { CANONICAL_INGREDIENTS } from "./data/canonical-ingredients.js";
import { canonicalIngredients, recipeIngredients, recipes } from "./schema.js";

/** Repo-root `data/recipes` (this file is `packages/db/src/import-recipes.ts`). */
export const RECIPES_DIR = fileURLToPath(new URL("../../../data/recipes", import.meta.url));

/** numeric → string with 2 dp (matches `import-ingredients.ts` `num()`). */
function num(v: number): string {
  return v.toFixed(2);
}

/** The dictionary keyed by slug, each entry validated (nulls resolved). */
export function ingredientIndex(
  entries: readonly unknown[] = CANONICAL_INGREDIENTS,
): Map<string, CanonicalIngredientSeed> {
  return new Map(
    entries.map((e) => {
      const parsed = canonicalIngredientSchema.parse(e);
      return [parsed.slug, parsed] as const;
    }),
  );
}

// ─── Loading + validation (pure) ───────────────────────────────────────────────

export interface RecipeFile {
  file: string;
  data: unknown;
}

/** Read + YAML-parse every `*.yaml` in `dir`, sorted for a deterministic order. */
export function loadRecipeFiles(dir: string = RECIPES_DIR): RecipeFile[] {
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  return names.map((file) => {
    const text = readFileSync(`${dir}/${file}`, "utf8");
    try {
      return { file, data: parseYaml(text) };
    } catch (err) {
      throw new Error(
        `${file}: invalid YAML — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}

/** Validate each file against `recipeSeedSchema`; slug must equal the filename stem. */
export function parseCorpus(files: RecipeFile[]): RecipeSeed[] {
  return files.map(({ file, data }) => {
    const result = recipeSeedSchema.safeParse(data);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      throw new Error(`${file}: ${where}${issue?.message ?? "invalid recipe"}`);
    }
    const stem = file.replace(/\.yaml$/, "");
    if (result.data.slug !== stem) {
      throw new Error(`${file}: slug "${result.data.slug}" must match the filename stem "${stem}"`);
    }
    return result.data;
  });
}

/** Throw if two recipes share a slug — a corpus authoring mistake. */
export function assertUniqueSlugs(entries: { slug: string }[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.slug)) throw new Error(`duplicate recipe slug: ${e.slug}`);
    seen.add(e.slug);
  }
}

// ─── Resolution (pure) ─────────────────────────────────────────────────────────

/** Grams contributed by one recipe line, via density (`ml`) or grams-per-piece (`pcs`). */
export function gramsForLine(
  entry: CanonicalIngredientSeed,
  amount: number,
  unit: string,
  ctx: string,
): number {
  if (unit === "pcs") {
    if (entry.gramsPerPiece == null) {
      throw new Error(
        `${ctx}: ingredient ${entry.slug} is in pcs but has no gramsPerPiece — use g/ml`,
      );
    }
    return amount * entry.gramsPerPiece;
  }
  try {
    return convert(amount, unit as Unit, "g", entry.densityGMl ?? undefined);
  } catch (err) {
    throw new Error(
      `${ctx}: cannot convert ${amount} ${unit} of ${entry.slug} to grams — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface ResolvedRecipe {
  slug: string;
  /** Ready for `insert(recipes)` (ids assigned by the DB). */
  row: {
    slug: string;
    titleUk: string;
    servings: number;
    activeMinutes: number;
    totalMinutes: number;
    difficulty: number;
    steps: string[];
    tags: string[];
    allergens: string[];
    kcalServing: string;
    proteinServing: string;
    fatServing: string;
    carbsServing: string;
  };
  /** Ready for `insert(recipe_ingredients)` once slugs are mapped to ids. */
  ingredients: { slug: string; amount: string; unit: string; optional: boolean }[];
}

/** `[mealType, season_*, ...dietary tags]` — the flat `recipes.tags` array. */
export function flattenTags(seed: RecipeSeed): string[] {
  return [seed.mealType, ...seed.seasons.map((s) => `season_${s}`), ...seed.tags];
}

/**
 * Compute a recipe's allergen union + per-serving macros from the dictionary and shape it
 * for insertion. Fail-closed: unknown ingredient slug, or an ingredient without macros,
 * throws. Optional ingredients still count toward both (a recipe *can* contain them —
 * conservative for allergens, a small over-estimate for macros, which are estimates anyway).
 */
export function resolveRecipe(
  seed: RecipeSeed,
  dict: Map<string, CanonicalIngredientSeed>,
): ResolvedRecipe {
  const ctx = `recipe ${seed.slug}`;
  const allergens = new Set<string>();
  const macroLines: { per100g: Macros; grams: number }[] = [];

  for (const line of seed.ingredients) {
    const spec = dict.get(line.slug);
    if (!spec) throw new Error(`${ctx}: unknown ingredient ${line.slug}`);
    if (!spec.per100g) throw new Error(`${ctx}: ingredient ${line.slug} has no macros`);
    for (const a of spec.allergens) allergens.add(a);
    macroLines.push({
      per100g: spec.per100g,
      grams: gramsForLine(spec, line.amount, line.unit, ctx),
    });
  }

  const macros = recipeMacros(macroLines, seed.servings);

  return {
    slug: seed.slug,
    row: {
      slug: seed.slug,
      titleUk: seed.titleUk,
      servings: seed.servings,
      activeMinutes: seed.activeMinutes,
      totalMinutes: seed.totalMinutes,
      difficulty: seed.difficulty,
      steps: seed.steps,
      tags: flattenTags(seed),
      allergens: [...allergens].sort(),
      kcalServing: num(macros.kcal),
      proteinServing: num(macros.protein),
      fatServing: num(macros.fat),
      carbsServing: num(macros.carbs),
    },
    ingredients: seed.ingredients.map((l) => ({
      slug: l.slug,
      amount: l.amount.toFixed(2),
      unit: l.unit,
      optional: l.optional,
    })),
  };
}

/** Load → validate → resolve the whole corpus (no DB). Throws on the first bad file. */
export function resolveCorpus(dir: string = RECIPES_DIR): ResolvedRecipe[] {
  const seeds = parseCorpus(loadRecipeFiles(dir));
  assertUniqueSlugs(seeds);
  const dict = ingredientIndex();
  return seeds.map((s) => resolveRecipe(s, dict));
}

// ─── DB import ─────────────────────────────────────────────────────────────────

export async function importRecipes(
  database: Db = db,
  dir: string = RECIPES_DIR,
): Promise<{ total: number; inserted: number; updated: number }> {
  const resolved = resolveCorpus(dir);

  const idBySlug = new Map(
    (
      await database
        .select({ id: canonicalIngredients.id, slug: canonicalIngredients.slug })
        .from(canonicalIngredients)
    ).map((r) => [r.slug, r.id]),
  );
  for (const r of resolved) {
    for (const line of r.ingredients) {
      if (!idBySlug.has(line.slug)) {
        throw new Error(
          `ingredient ${line.slug} (recipe ${r.slug}) is not in the DB — run \`pnpm db:import:ingredients\` first`,
        );
      }
    }
  }

  let inserted = 0;
  for (const r of resolved) {
    const [ret] = await database
      .insert(recipes)
      .values(r.row)
      .onConflictDoUpdate({
        target: recipes.slug,
        set: {
          titleUk: sql`excluded.title_uk`,
          servings: sql`excluded.servings`,
          activeMinutes: sql`excluded.active_minutes`,
          totalMinutes: sql`excluded.total_minutes`,
          difficulty: sql`excluded.difficulty`,
          steps: sql`excluded.steps`,
          tags: sql`excluded.tags`,
          allergens: sql`excluded.allergens`,
          kcalServing: sql`excluded.kcal_serving`,
          proteinServing: sql`excluded.protein_serving`,
          fatServing: sql`excluded.fat_serving`,
          carbsServing: sql`excluded.carbs_serving`,
        },
      })
      .returning({ id: recipes.id, inserted: sql<boolean>`(xmax = 0)` });
    if (!ret) throw new Error(`upsert of recipe ${r.slug} returned no row`);
    if (ret.inserted) inserted += 1;

    // Replace the ingredient lines wholesale (PK is (recipe_id, ingredient_id)).
    await database.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, ret.id));
    await database.insert(recipeIngredients).values(
      r.ingredients.map((l) => ({
        recipeId: ret.id,
        ingredientId: idBySlug.get(l.slug)!,
        amount: l.amount,
        unit: l.unit,
        optional: l.optional,
      })),
    );
  }

  // Prune recipes that left the corpus (recipe_ingredients FK cascades).
  const slugs = resolved.map((r) => r.slug);
  if (slugs.length > 0) {
    await database.delete(recipes).where(notInArray(recipes.slug, slugs));
  }

  return { total: resolved.length, inserted, updated: resolved.length - inserted };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importRecipes()
    .then(({ total, inserted, updated }) => {
      console.log(`[import:recipes] ${total} recipes — ${inserted} inserted, ${updated} updated`);
    })
    .then(closeDb)
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
