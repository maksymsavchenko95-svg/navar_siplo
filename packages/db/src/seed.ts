import {
  convert,
  type Macros,
  type CanonicalIngredientInput,
  recipeMacros,
  type Unit,
} from "@navar/domain";
import { eq, sql } from "drizzle-orm";

import { closeDb, db } from "./client.js";
import { CANONICAL_INGREDIENTS } from "./data/canonical-ingredients.js";
import { importCanonicalIngredients } from "./import-ingredients.js";
import {
  canonicalIngredients,
  householdMembers,
  householdRestrictions,
  households,
  nutritionTargets,
  recipeIngredients,
  recipes,
} from "./schema.js";

/**
 * Demo fixture for the boilerplate. The ingredient dictionary comes from
 * `import-ingredients.ts` (T1.2); this file adds a couple of demo recipes and one
 * `form`-mode household until the YAML recipe corpus + importer land (T1.3).
 *
 * Non-destructive: the ingredient dictionary is upserted (not truncated), the demo
 * household is upserted on a stable `silpo_user_ref` so a re-seed keeps its
 * `mcp_credentials` row. Only the recipe corpus and this household's child rows are replaced.
 */

const DEMO_REF = "demo";

type RecipeSeed = {
  slug: string;
  titleUk: string;
  servings: number;
  activeMinutes: number;
  totalMinutes: number;
  difficulty: number;
  steps: string[];
  tags: string[];
  ingredients: { slug: string; amount: string; unit: string; optional?: boolean }[];
};

const RECIPES: RecipeSeed[] = [
  {
    slug: "chicken_plov",
    titleUk: "Плов з куркою",
    servings: 4,
    activeMinutes: 20,
    totalMinutes: 55,
    difficulty: 2,
    steps: [
      "Обсмажити курку до золястості.",
      "Додати моркву, тушкувати 5 хв.",
      "Всипати рис, залити водою, готувати під кришкою 25 хв.",
    ],
    tags: ["dinner", "kids_friendly", "reheatable"],
    ingredients: [
      { slug: "chicken_breast", amount: "500", unit: "g" },
      { slug: "rice_long_grain", amount: "400", unit: "g" },
      { slug: "carrot", amount: "200", unit: "g" },
      { slug: "sunflower_oil", amount: "40", unit: "ml" },
    ],
  },
  {
    slug: "carrot_omelette",
    titleUk: "Омлет з морквою",
    servings: 2,
    activeMinutes: 10,
    totalMinutes: 15,
    difficulty: 1,
    steps: ["Натерти моркву, злегка обсмажити.", "Залити збитими яйцями, готувати 4 хв."],
    tags: ["breakfast", "vegetarian", "gluten_free", "kids_friendly"],
    ingredients: [
      { slug: "egg", amount: "4", unit: "pcs" },
      { slug: "carrot", amount: "100", unit: "g" },
      { slug: "sunflower_oil", amount: "15", unit: "ml", optional: true },
    ],
  },
];

/** Grams for a recipe line, using density for `ml` and grams-per-piece for `pcs`. */
function grams(entry: CanonicalIngredientInput, amount: number, unit: string): number {
  if (unit === "pcs") return amount * (entry.gramsPerPiece ?? 0);
  return convert(amount, unit as Unit, "g", entry.densityGMl ?? undefined);
}

function n(x: number): string {
  return x.toFixed(2);
}

async function seed(): Promise<void> {
  const bySlug = new Map(CANONICAL_INGREDIENTS.map((i) => [i.slug, i]));

  // Ingredient dictionary — idempotent upsert (never truncated: FK from recipe_ingredients).
  const dict = await importCanonicalIngredients(db);

  // Recipe corpus — replaced wholesale (placeholder until T1.3).
  await db.execute(sql`TRUNCATE TABLE ${recipeIngredients}, ${recipes} RESTART IDENTITY CASCADE`);

  const idBySlug = new Map(
    (
      await db
        .select({ id: canonicalIngredients.id, slug: canonicalIngredients.slug })
        .from(canonicalIngredients)
    ).map((r) => [r.slug, r.id]),
  );

  for (const r of RECIPES) {
    const allergens = [
      ...new Set(r.ingredients.flatMap((ri) => bySlug.get(ri.slug)?.allergens ?? [])),
    ].sort();

    // Per-serving macros, computed from the ingredients (never hand-set).
    const macros = recipeMacros(
      r.ingredients.map((ri) => {
        const spec = bySlug.get(ri.slug);
        if (!spec) throw new Error(`recipe ${r.slug} references unknown ingredient ${ri.slug}`);
        if (!spec.per100g) throw new Error(`ingredient ${ri.slug} has no macros`);
        return {
          per100g: spec.per100g as Macros,
          grams: grams(spec, Number(ri.amount), ri.unit),
        };
      }),
      r.servings,
    );

    const [row] = await db
      .insert(recipes)
      .values({
        slug: r.slug,
        titleUk: r.titleUk,
        servings: r.servings,
        activeMinutes: r.activeMinutes,
        totalMinutes: r.totalMinutes,
        difficulty: r.difficulty,
        steps: r.steps,
        tags: r.tags,
        allergens,
        kcalServing: n(macros.kcal),
        proteinServing: n(macros.protein),
        fatServing: n(macros.fat),
        carbsServing: n(macros.carbs),
      })
      .returning();

    await db.insert(recipeIngredients).values(
      r.ingredients.map((ri) => {
        const id = idBySlug.get(ri.slug);
        if (!id) throw new Error(`no id for ingredient ${ri.slug}`);
        return {
          recipeId: row!.id,
          ingredientId: id,
          amount: ri.amount,
          unit: ri.unit,
          optional: ri.optional ?? false,
        };
      }),
    );
  }

  // Demo household — upsert so `mcp_credentials` survives a re-seed.
  const [hh] = await db
    .insert(households)
    .values({ silpoUserRef: DEMO_REF, goal: "form", weeklyBudget: "2500.00" })
    .onConflictDoUpdate({
      target: households.silpoUserRef,
      set: { goal: "form", weeklyBudget: "2500.00" },
    })
    .returning();

  await db.delete(householdMembers).where(eq(householdMembers.householdId, hh!.id));
  await db.delete(householdRestrictions).where(eq(householdRestrictions.householdId, hh!.id));
  await db.delete(nutritionTargets).where(eq(nutritionTargets.householdId, hh!.id));

  await db.insert(householdMembers).values([
    { householdId: hh!.id, kind: "adult", label: "A" },
    { householdId: hh!.id, kind: "adult", label: "B" },
    { householdId: hh!.id, kind: "child", ageYears: 6, label: "C" },
  ]);

  await db.insert(householdRestrictions).values({
    householdId: hh!.id,
    kind: "dislike",
    code: "mushroom",
    severity: "soft",
    source: "onboarding",
  });

  // goal='form' → a nutrition target (exercises the table, the FK and the kcal CHECK).
  await db.insert(nutritionTargets).values({
    householdId: hh!.id,
    proteinMinG: 135,
    kcalTarget: 2400,
    direction: "gain",
    computedFrom: {
      sex: "male",
      ageYears: 32,
      weightKg: 78,
      heightCm: 182,
      activity: "moderate",
      direction: "gain",
    },
  });

  console.log(
    `[seed] ${dict.total} ingredients (${dict.inserted} new), ${RECIPES.length} recipes, 1 household (goal=form)`,
  );
}

seed()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
