import { canonicalIngredientSchema } from "@navar/domain";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "./client.js";
import { canonicalIngredients } from "./schema.js";
import { assertUniqueSlugs, importCanonicalIngredients, toRow } from "./import-ingredients.js";

describe("toRow", () => {
  it("stringifies numerics to 2 dp and passes nulls through", () => {
    const parsed = canonicalIngredientSchema.parse({
      slug: "egg",
      nameUk: "Яйця курячі",
      category: "dairy_eggs",
      baseUnit: "pcs",
      gramsPerPiece: 55,
      allergens: ["egg"],
      per100g: { kcal: 157, protein: 12.7, fat: 11.5, carbs: 0.7, fiber: 0 },
      nutritionSrc: "reference",
    });
    expect(toRow(parsed)).toEqual({
      slug: "egg",
      nameUk: "Яйця курячі",
      category: "dairy_eggs",
      baseUnit: "pcs",
      densityGMl: null,
      gramsPerPiece: "55.00",
      allergens: ["egg"],
      synonyms: [],
      perishableDays: null,
      kcal100: "157.00",
      protein100: "12.70",
      fat100: "11.50",
      carbs100: "0.70",
      fiber100: "0.00",
      nutritionSrc: "reference",
    });
  });

  it("leaves macro columns null when the entry has no per100g", () => {
    const parsed = canonicalIngredientSchema.parse({
      slug: "coffee",
      nameUk: "Кава",
      category: "beverage",
      baseUnit: "g",
    });
    expect(toRow(parsed)).toMatchObject({ kcal100: null, protein100: null, nutritionSrc: null });
  });
});

describe("assertUniqueSlugs", () => {
  it("throws on a duplicate", () => {
    expect(() => assertUniqueSlugs([{ slug: "a" }, { slug: "a" }])).toThrow(/duplicate/);
  });
});

// Integration — only when a database is reachable.
describe.skipIf(!process.env.DATABASE_URL)("importCanonicalIngredients (integration)", () => {
  afterAll(closeDb);

  it("is idempotent: row count is stable across two runs and re-run corrects a drifted row", async () => {
    const first = await importCanonicalIngredients();
    expect(first.inserted + first.updated).toBe(first.total);
    const countAfterFirst = await db.$count(canonicalIngredients);

    // Corrupt one row, then re-import — the upsert must converge it back.
    await db
      .update(canonicalIngredients)
      .set({ nameUk: "WRONG", kcal100: "0.01" })
      .where(sql`slug = 'chicken_breast'`);

    const second = await importCanonicalIngredients();
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(second.total);
    expect(await db.$count(canonicalIngredients)).toBe(countAfterFirst);

    const [row] = await db
      .select({ nameUk: canonicalIngredients.nameUk })
      .from(canonicalIngredients)
      .where(sql`slug = 'chicken_breast'`);
    expect(row?.nameUk).toBe("Куряче філе");
  });
});
