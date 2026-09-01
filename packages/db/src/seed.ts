import { convert, type Macros, recipeMacros, type Unit } from "@navar/domain";
import { eq, sql } from "drizzle-orm";

import { closeDb, db } from "./client.js";
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
 * Demo fixture for the boilerplate. Placeholder until the YAML recipe corpus + importer
 * land with the planner work (TDD §2, §8 day 2–3).
 *
 * Non-destructive: the demo household is upserted on a stable `silpo_user_ref`, so a
 * re-seed keeps its `mcp_credentials` row. Only the recipe corpus and this household's
 * child rows are replaced.
 */

const DEMO_REF = "demo";

type IngredientSeed = {
  slug: string;
  nameUk: string;
  category: string;
  baseUnit: string;
  densityGMl?: string;
  allergens?: string[];
  synonyms?: string[];
  perishableDays?: number;
  /** Macros per 100 g of base unit. `nutrition_src = 'reference'` for all seed rows. */
  per100g: Macros;
};

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

/** Grams per piece for `pcs` ingredients — the seed's stand-in for a real conversion table. */
const PIECE_GRAMS: Record<string, number> = { egg: 50 };

const INGREDIENTS: IngredientSeed[] = [
  {
    slug: "chicken_breast",
    nameUk: "Куряче філе",
    category: "meat",
    baseUnit: "g",
    perishableDays: 3,
    synonyms: ["філе куряче"],
    per100g: { kcal: 120, protein: 23, fat: 2.6, carbs: 0, fiber: 0 },
  },
  {
    slug: "rice",
    nameUk: "Рис",
    category: "grain",
    baseUnit: "g",
    perishableDays: 365,
    per100g: { kcal: 360, protein: 7, fat: 1, carbs: 79, fiber: 1.3 },
  },
  {
    slug: "carrot",
    nameUk: "Морква",
    category: "vegetable",
    baseUnit: "g",
    perishableDays: 21,
    per100g: { kcal: 41, protein: 0.9, fat: 0.2, carbs: 10, fiber: 2.8 },
  },
  {
    slug: "egg",
    nameUk: "Яйця",
    category: "dairy_eggs",
    baseUnit: "pcs",
    allergens: ["egg"],
    perishableDays: 28,
    per100g: { kcal: 143, protein: 13, fat: 9.5, carbs: 0.7, fiber: 0 },
  },
  {
    slug: "sunflower_oil",
    nameUk: "Олія соняшникова",
    category: "pantry",
    baseUnit: "ml",
    densityGMl: "0.920",
    synonyms: ["олія"],
    perishableDays: 365,
    per100g: { kcal: 884, protein: 0, fat: 100, carbs: 0, fiber: 0 },
  },
];

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
      { slug: "rice", amount: "400", unit: "g" },
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

/** Grams for a recipe line, using density for `ml` and a piece table for `pcs`. */
function grams(slug: string, amount: number, unit: string, densityGMl?: string): number {
  if (unit === "pcs") return amount * (PIECE_GRAMS[slug] ?? 0);
  return convert(amount, unit as Unit, "g", densityGMl ? Number(densityGMl) : undefined);
}

function n(x: number): string {
  return x.toFixed(2);
}

async function seed(): Promise<void> {
  const bySlug = new Map(INGREDIENTS.map((i) => [i.slug, i]));

  await db.execute(
    sql`TRUNCATE TABLE ${recipeIngredients}, ${recipes}, ${canonicalIngredients} RESTART IDENTITY CASCADE`,
  );

  const ing = await db
    .insert(canonicalIngredients)
    .values(
      INGREDIENTS.map((i) => ({
        slug: i.slug,
        nameUk: i.nameUk,
        category: i.category,
        baseUnit: i.baseUnit,
        densityGMl: i.densityGMl,
        allergens: i.allergens ?? [],
        synonyms: i.synonyms ?? [],
        perishableDays: i.perishableDays,
        kcal100: n(i.per100g.kcal),
        protein100: n(i.per100g.protein),
        fat100: n(i.per100g.fat),
        carbs100: n(i.per100g.carbs),
        fiber100: n(i.per100g.fiber ?? 0),
        nutritionSrc: "reference",
      })),
    )
    .returning();

  const idBySlug = new Map(ing.map((i) => [i.slug, i.id]));

  for (const r of RECIPES) {
    const allergens = [
      ...new Set(r.ingredients.flatMap((ri) => bySlug.get(ri.slug)?.allergens ?? [])),
    ].sort();

    // Per-serving macros, computed from the ingredients (never hand-set).
    const macros = recipeMacros(
      r.ingredients.map((ri) => {
        const spec = bySlug.get(ri.slug)!;
        return {
          per100g: spec.per100g,
          grams: grams(ri.slug, Number(ri.amount), ri.unit, spec.densityGMl),
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
      r.ingredients.map((ri) => ({
        recipeId: row!.id,
        ingredientId: idBySlug.get(ri.slug)!,
        amount: ri.amount,
        unit: ri.unit,
        optional: ri.optional ?? false,
      })),
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
    `[seed] ${ing.length} ingredients, ${RECIPES.length} recipes, 1 household (goal=form)`,
  );
}

seed()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
