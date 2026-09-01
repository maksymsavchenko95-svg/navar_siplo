import {
  computeNutritionTargets,
  type ConsumptionModel,
  type NutritionComputedFrom,
} from "@navar/domain";
import { eq } from "drizzle-orm";

import { closeDb, db } from "./client.js";
import { importCanonicalIngredients } from "./import-ingredients.js";
import { importRecipes } from "./import-recipes.js";
import {
  consumptionModels,
  householdMembers,
  householdPreferences,
  householdRestrictions,
  households,
  nutritionTargets,
} from "./schema.js";

/**
 * Demo fixture for the boilerplate. The ingredient dictionary comes from
 * `import-ingredients.ts` (T1.2); the recipe corpus from `import-recipes.ts` (T1.3 —
 * `data/recipes/*.yaml`). This file only adds one `form`-mode demo household on top.
 *
 * Non-destructive: the dictionary and the corpus are upserted (never truncated); the demo
 * household is upserted on a stable `silpo_user_ref` so a re-seed keeps its
 * `mcp_credentials` row. Only this household's child rows are replaced.
 */

const DEMO_REF = "demo";

async function seed(): Promise<void> {
  // Ingredient dictionary — idempotent upsert (never truncated: FK from recipe_ingredients).
  const dict = await importCanonicalIngredients(db);

  // Recipe corpus — idempotent upsert on slug + prune (never truncated).
  const corpus = await importRecipes(db);

  // Demo household — upsert so `mcp_credentials` survives a re-seed. `bootstrapStatus:'done'`
  // + a seeded ConsumptionModel/preferences so `household.get` / `inferredTastes` return a
  // full portrait offline, without a live MCP call (T1.4).
  const [hh] = await db
    .insert(households)
    .values({
      silpoUserRef: DEMO_REF,
      goal: "form",
      weeklyBudget: "2500.00",
      bootstrapStatus: "done",
      bootstrappedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: households.silpoUserRef,
      set: {
        goal: "form",
        weeklyBudget: "2500.00",
        bootstrapStatus: "done",
        bootstrappedAt: new Date(),
      },
    })
    .returning();

  await db.delete(householdMembers).where(eq(householdMembers.householdId, hh!.id));
  await db.delete(householdRestrictions).where(eq(householdRestrictions.householdId, hh!.id));
  await db.delete(nutritionTargets).where(eq(nutritionTargets.householdId, hh!.id));
  await db.delete(consumptionModels).where(eq(consumptionModels.householdId, hh!.id));
  await db.delete(householdPreferences).where(eq(householdPreferences.householdId, hh!.id));

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

  // goal='form' → a nutrition target, computed the same way `household.computeNutrition`
  // does (T1.5) so the fixture never drifts from the formula.
  const computedFrom: NutritionComputedFrom = {
    sex: "male",
    ageYears: 32,
    weightKg: 78,
    heightCm: 182,
    activity: "moderate",
    direction: "gain",
  };
  const targets = computeNutritionTargets(computedFrom);
  await db.insert(nutritionTargets).values({
    householdId: hh!.id,
    proteinMinG: targets.proteinMinG,
    kcalTarget: targets.kcalTarget,
    kcalTolerance: String(targets.kcalTolerance),
    direction: targets.direction,
    computedFrom,
  });

  // Derived purchase model (T1.4) — plausible values over real ingredient slugs.
  const demoModel: ConsumptionModel = {
    source: "receipts",
    orderCount: 14,
    window: { start: "2026-03-04T00:00:00.000Z", end: "2026-08-30T00:00:00.000Z" },
    medianWeeklyChequeUah: 1850,
    buyFrequency: [
      {
        key: "milk",
        label: "Молоко",
        category: "dairy_eggs",
        buysPer4Weeks: 4,
        avgQuantity: 1,
        unit: "l",
        lastBoughtDaysAgo: 3,
        orderShare: 0.71,
      },
      {
        key: "chicken_breast",
        label: "Куряче філе",
        category: "meat",
        buysPer4Weeks: 2.5,
        avgQuantity: 0.6,
        unit: "kg",
        lastBoughtDaysAgo: 4,
        orderShare: 0.5,
      },
      {
        key: "buckwheat_groats",
        label: "Гречка",
        category: "grain",
        buysPer4Weeks: 1.5,
        avgQuantity: 0.8,
        unit: "kg",
        lastBoughtDaysAgo: 9,
        orderShare: 0.36,
      },
      {
        key: "egg",
        label: "Яйця",
        category: "dairy_eggs",
        buysPer4Weeks: 2,
        avgQuantity: 10,
        unit: "pcs",
        lastBoughtDaysAgo: 6,
        orderShare: 0.43,
      },
      {
        key: "white_bread",
        label: "Хліб пшеничний",
        category: "bakery",
        buysPer4Weeks: 3.5,
        avgQuantity: 1,
        unit: null,
        lastBoughtDaysAgo: 2,
        orderShare: 0.64,
      },
      {
        key: "banana",
        label: "Банани",
        category: "fruit",
        buysPer4Weeks: 2,
        avgQuantity: 1,
        unit: "kg",
        lastBoughtDaysAgo: 5,
        orderShare: 0.5,
      },
      {
        key: "hard_cheese",
        label: "Сир твердий",
        category: "dairy_eggs",
        buysPer4Weeks: 0.5,
        avgQuantity: 0.2,
        unit: "kg",
        lastBoughtDaysAgo: 55,
        orderShare: 0.1,
      },
    ],
    brandAffinity: [
      { brand: "Галичина", category: "dairy_eggs", purchases: 6, categoryShare: 0.4 },
      { brand: "Наша Ряба", category: "meat", purchases: 4, categoryShare: 0.5 },
      { brand: "Моршинська", category: "beverage", purchases: 3, categoryShare: 0.6 },
    ],
  };
  await db.insert(consumptionModels).values({
    householdId: hh!.id,
    source: "receipts",
    orderCount: demoModel.orderCount,
    windowStart: new Date(demoModel.window!.start),
    windowEnd: new Date(demoModel.window!.end),
    medianWeeklyChequeUah: "1850.00",
    model: demoModel,
    inferredTags: ["fresh_produce_heavy", "brand_loyal", "batch_cooks"],
    inferSummary:
      "Ви регулярно берете молочне, курятину та крупи; середній тижневий чек — близько 1850 ₴.",
  });

  await db.insert(householdPreferences).values({
    householdId: hh!.id,
    source: "inferred",
    dislikedIngredients: ["mushroom"],
    cookingWeekdays: [1, 3, 5],
    maxPrepMinutes: 40,
  });

  console.log(
    `[seed] ${dict.total} ingredients (${dict.inserted} new), ` +
      `${corpus.total} recipes (${corpus.inserted} new), 1 household (goal=form, bootstrap=done)`,
  );
}

seed()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
