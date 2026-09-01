import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RecipeSeedInput } from "@navar/domain";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "./client.js";
import { importCanonicalIngredients } from "./import-ingredients.js";
import {
  RECIPES_DIR,
  assertUniqueSlugs,
  flattenTags,
  gramsForLine,
  importRecipes,
  ingredientIndex,
  parseCorpus,
  resolveRecipe,
} from "./import-recipes.js";
import { recipes } from "./schema.js";

// A tiny inline dictionary — parsed through the real schema (nulls resolved).
const DICT = ingredientIndex([
  {
    slug: "test_chicken",
    nameUk: "Тестова курка",
    category: "meat",
    baseUnit: "g",
    per100g: { kcal: 100, protein: 20, fat: 2, carbs: 0, fiber: 0 },
    nutritionSrc: "reference",
  },
  {
    slug: "test_milk",
    nameUk: "Тестове молоко",
    category: "dairy_eggs",
    baseUnit: "ml",
    densityGMl: 1,
    allergens: ["milk"],
    per100g: { kcal: 60, protein: 3, fat: 3, carbs: 5, fiber: 0 },
    nutritionSrc: "reference",
  },
  {
    slug: "test_egg",
    nameUk: "Тестове яйце",
    category: "dairy_eggs",
    baseUnit: "pcs",
    gramsPerPiece: 50,
    allergens: ["egg"],
    per100g: { kcal: 150, protein: 12, fat: 10, carbs: 1, fiber: 0 },
    nutritionSrc: "reference",
  },
  {
    slug: "test_water",
    nameUk: "Вода",
    category: "beverage",
    baseUnit: "ml",
  },
]);

const RECIPE: RecipeSeedInput = {
  slug: "test_dish",
  titleUk: "Тестова страва",
  servings: 2,
  activeMinutes: 10,
  totalMinutes: 20,
  difficulty: 1,
  mealType: "dinner",
  seasons: ["autumn", "all_year"],
  tags: ["reheatable"],
  steps: ["Крок один."],
  ingredients: [
    { slug: "test_chicken", amount: 300, unit: "g" },
    { slug: "test_milk", amount: 200, unit: "ml" },
    { slug: "test_egg", amount: 2, unit: "pcs" },
  ],
};

function parse(input: RecipeSeedInput) {
  return parseCorpus([{ file: `${input.slug}.yaml`, data: input }])[0]!;
}

describe("gramsForLine", () => {
  it("uses density for ml", () => {
    expect(gramsForLine(DICT.get("test_milk")!, 250, "ml", "ctx")).toBe(250);
  });
  it("uses grams-per-piece for pcs", () => {
    expect(gramsForLine(DICT.get("test_egg")!, 3, "pcs", "ctx")).toBe(150);
  });
  it("scales kg to grams", () => {
    expect(gramsForLine(DICT.get("test_chicken")!, 1, "kg", "ctx")).toBe(1000);
  });
  it("throws for a pcs ingredient with no piece weight", () => {
    const noPiece = ingredientIndex([
      { slug: "x", nameUk: "X", category: "other", baseUnit: "pcs" },
    ]).get("x")!;
    expect(() => gramsForLine(noPiece, 1, "pcs", "recipe x")).toThrow(/gramsPerPiece/);
  });
});

describe("resolveRecipe", () => {
  it("computes per-serving macros and the sorted allergen union", () => {
    const r = resolveRecipe(parse(RECIPE), DICT);
    // chicken 300 g → 300 kcal / 60 g protein; milk 200 g → 120 / 6; egg 100 g → 150 / 12
    // totals 570 kcal / 78 g protein ÷ 2 servings
    expect(r.row.kcalServing).toBe("285.00");
    expect(r.row.proteinServing).toBe("39.00");
    expect(r.row.allergens).toEqual(["egg", "milk"]);
  });

  it("flattens meal type + seasons + tags into the tags column", () => {
    const r = resolveRecipe(parse(RECIPE), DICT);
    expect(r.row.tags).toEqual(["dinner", "season_autumn", "season_all_year", "reheatable"]);
  });

  it("keeps ingredient lines as fixed-dp strings", () => {
    const r = resolveRecipe(parse(RECIPE), DICT);
    expect(r.ingredients[0]).toEqual({
      slug: "test_chicken",
      amount: "300.00",
      unit: "g",
      optional: false,
    });
  });

  it("throws on an unknown ingredient slug", () => {
    const bad = parse({ ...RECIPE, ingredients: [{ slug: "test_ghost", amount: 1, unit: "g" }] });
    expect(() => resolveRecipe(bad, DICT)).toThrow(/unknown ingredient test_ghost/);
  });

  it("throws when a referenced ingredient has no macros", () => {
    const bad = parse({ ...RECIPE, ingredients: [{ slug: "test_water", amount: 1, unit: "ml" }] });
    expect(() => resolveRecipe(bad, DICT)).toThrow(/has no macros/);
  });
});

describe("flattenTags", () => {
  it("prefixes seasons and preserves order", () => {
    expect(
      flattenTags(parse({ ...RECIPE, seasons: ["winter"], tags: ["budget", "one_pot"] })),
    ).toEqual(["dinner", "season_winter", "budget", "one_pot"]);
  });
});

describe("parseCorpus", () => {
  it("names the file and the failing field on a schema error", () => {
    expect(() => parseCorpus([{ file: "broken.yaml", data: { slug: "broken" } }])).toThrow(
      /^broken\.yaml:/,
    );
  });

  it("rejects a slug that does not match the filename stem", () => {
    expect(() => parseCorpus([{ file: "one.yaml", data: { ...RECIPE, slug: "two" } }])).toThrow(
      /filename stem "one"/,
    );
  });
});

describe("assertUniqueSlugs", () => {
  it("throws on a duplicate", () => {
    expect(() => assertUniqueSlugs([{ slug: "a" }, { slug: "a" }])).toThrow(
      /duplicate recipe slug/,
    );
  });
});

// Integration — only when a database is reachable.
describe.skipIf(!process.env.DATABASE_URL)("importRecipes (integration)", () => {
  afterAll(closeDb);

  it("is idempotent, converges a drifted row, and prunes a removed recipe", async () => {
    await importCanonicalIngredients();

    const first = await importRecipes();
    expect(first.inserted + first.updated).toBe(first.total);
    const fullCount = await db.$count(recipes);
    expect(fullCount).toBe(first.total);

    await db
      .update(recipes)
      .set({ titleUk: "WRONG" })
      .where(sql`true`);
    const second = await importRecipes();
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(second.total);
    expect(await db.$count(recipes)).toBe(fullCount);
    const drifted = await db.$count(recipes, sql`title_uk = 'WRONG'`);
    expect(drifted).toBe(0);

    // Prune: import from a temp dir holding a two-file subset.
    const subset = mkdtempSync(join(tmpdir(), "navar-recipes-"));
    for (const f of readdirSync(RECIPES_DIR).slice(0, 2)) {
      cpSync(join(RECIPES_DIR, f), join(subset, f));
    }
    await importRecipes(db, subset);
    expect(await db.$count(recipes)).toBe(2);

    // Restore the full corpus for anything downstream.
    await importRecipes();
    expect(await db.$count(recipes)).toBe(fullCount);
  });
});
