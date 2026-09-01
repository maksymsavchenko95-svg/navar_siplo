import { eq } from "drizzle-orm";

import { closeDb, db } from "./client.js";
import { importCanonicalIngredients } from "./import-ingredients.js";
import { importRecipes } from "./import-recipes.js";
import { householdMembers, householdRestrictions, households, nutritionTargets } from "./schema.js";

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
    `[seed] ${dict.total} ingredients (${dict.inserted} new), ` +
      `${corpus.total} recipes (${corpus.inserted} new), 1 household (goal=form)`,
  );
}

seed()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
