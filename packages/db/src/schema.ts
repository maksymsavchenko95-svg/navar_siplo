import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import type { ConsumptionModel, NutritionComputedFrom } from "@navar/domain";

/**
 * P0 schema — TDD v0.2 §3. Identity + recipe corpus only; the plan / receipt / pantry /
 * shopping-list tables land with their features (TDD §8, days 3–8). Table and column
 * names follow the TDD (plural, `_uk` suffix). IDs are `uuid` with a separate unique
 * `slug` (the human key used by the YAML corpus and the golden mapping dataset).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ─── Identity ───────────────────────────────────────────────────────────────────

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Opaque Silpo reference (never the phone). Null until `household.bootstrap` reads MCP.
  silpoUserRef: text("silpo_user_ref").unique(),
  // routine | form — goal mode is solver configuration, not a code branch (ADR-09).
  goal: text("goal").notNull().default("routine"),
  weeklyBudget: numeric("weekly_budget", { precision: 10, scale: 2 }),
  branchId: text("branch_id"),
  deliveryType: text("delivery_type"),
  // household.bootstrap lifecycle (T1.4). idle | running | onboarding_required | done | error
  bootstrapStatus: text("bootstrap_status").notNull().default("idle"),
  bootstrapError: text("bootstrap_error"),
  bootstrappedAt: timestamp("bootstrapped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Nutrient profile — only for `goal='form'` households. Computed by the system from body
 * metrics + activity (`FR-GOAL-003`, `household.computeNutrition`), never entered directly.
 * `kcal_target` can never sit below `KCAL_FLOOR` — enforced here (DB CHECK), in
 * `nutritionTargetsSchema`, and in `assertKcalFloor` (`FR-SAFE-009`, fail-closed).
 */
export const nutritionTargets = pgTable(
  "nutrition_targets",
  {
    householdId: uuid("household_id")
      .primaryKey()
      .references(() => households.id, { onDelete: "cascade" }),
    proteinMinG: integer("protein_min_g").notNull(), // hard daily lower bound
    kcalTarget: integer("kcal_target").notNull(), // centre of the corridor
    kcalTolerance: numeric("kcal_tolerance", { precision: 3, scale: 2 }).notNull().default("0.15"),
    direction: text("direction").notNull(), // gain | maintain | reduce
    computedFrom: jsonb("computed_from").$type<NutritionComputedFrom>().notNull(),
  },
  // 1200 = KCAL_FLOOR in @navar/domain (FR-SAFE-009). Literal here so drizzle-kit's
  // schema bundler stays free of a runtime cross-package import.
  (t) => [check("kcal_floor", sql`${t.kcalTarget} >= 1200`)],
);

export const householdMembers = pgTable("household_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // adult | child | pet
  ageYears: integer("age_years"),
  label: text("label"),
});

export const householdRestrictions = pgTable(
  "household_restrictions",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // allergen | diet | dislike
    code: text("code").notNull(), // normalised code
    severity: text("severity").notNull().default("strict"), // strict | soft
    source: text("source").notNull(), // mcp | onboarding | inferred | guest
    // null = still a system assumption; set when the guest accepts it (FR-HH-004).
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.kind, t.code] })],
);

/**
 * Derived purchase model (`FR-HH-002`), 1:1 with a household. `model` is the full
 * `ConsumptionModel` (buy frequency, brand affinity); scalar columns mirror the
 * queryable bits. `inferred_tags` / `infer_summary` come from the `inferConsumption` LLM
 * step (interpretation only — the numbers in `model` are deterministic, ADR-02).
 */
export const consumptionModels = pgTable("consumption_models", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // receipts | onboarding
  orderCount: integer("order_count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }),
  medianWeeklyChequeUah: numeric("median_weekly_cheque_uah", { precision: 10, scale: 2 }),
  model: jsonb("model").$type<ConsumptionModel>().notNull(),
  inferredTags: jsonb("inferred_tags").$type<string[]>().notNull().default([]),
  inferSummary: text("infer_summary"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Guest cooking preferences (SRS §5 `HouseholdPreferences`), 1:1 with a household. Budget
 * itself stays on `households.weekly_budget` (`FR-HH-007`).
 */
export const householdPreferences = pgTable("household_preferences", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  dislikedIngredients: text("disliked_ingredients").array().notNull().default([]), // canonical slugs
  maxPrepMinutes: integer("max_prep_minutes"),
  cookingWeekdays: integer("cooking_weekdays").array().notNull().default([]), // 0..6
  difficultyCap: integer("difficulty_cap"), // 1..3
  source: text("source").notNull(), // onboarding | inferred | guest
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * MCP tokens, encrypted at rest, one row per household, separate table / separate
 * access (TDD §3, `NFR-SEC-001`). `payload` is the AES-256-GCM ciphertext of the full
 * token set (access + refresh + DCR client info + PKCE verifier) — see `credentials.ts`.
 * `expires_at` is kept in clear for cheap refresh checks.
 */
export const mcpCredentials = pgTable("mcp_credentials", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  payload: bytea("payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Recipe corpus ─────────────────────────────────────────────────────────────

export const canonicalIngredients = pgTable(
  "canonical_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(), // 'chicken_breast'
    nameUk: text("name_uk").notNull(),
    category: text("category").notNull(),
    baseUnit: text("base_unit").notNull(), // g | ml | pcs
    densityGMl: numeric("density_g_ml", { precision: 6, scale: 3 }),
    gramsPerPiece: numeric("grams_per_piece", { precision: 7, scale: 2 }), // for base_unit = 'pcs'
    allergens: text("allergens").array().notNull().default([]),
    synonyms: text("synonyms").array().notNull().default([]),
    perishableDays: integer("perishable_days"),
    // Macros per 100 g of base_unit (TDD §3, source `Q-09`). Weighed produce/meat/grains
    // get these from a reference table, not the SKU.
    kcal100: numeric("kcal_100", { precision: 7, scale: 2 }),
    protein100: numeric("protein_100", { precision: 6, scale: 2 }),
    fat100: numeric("fat_100", { precision: 6, scale: 2 }),
    carbs100: numeric("carbs_100", { precision: 6, scale: 2 }),
    fiber100: numeric("fiber_100", { precision: 6, scale: 2 }),
    nutritionSrc: text("nutrition_src"), // catalog | reference | estimated
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [
    uniqueIndex("canonical_ingredients_slug_key").on(t.slug),
    index("canonical_ingredients_name_uk_trgm").using("gin", sql`${t.nameUk} gin_trgm_ops`),
    index("canonical_ingredients_embedding_hnsw").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    titleUk: text("title_uk").notNull(),
    servings: integer("servings").notNull(),
    activeMinutes: integer("active_minutes").notNull(),
    totalMinutes: integer("total_minutes").notNull(),
    difficulty: integer("difficulty").notNull(), // 1..3
    steps: jsonb("steps").$type<string[]>().notNull(),
    // No `fitness` tag — form-mode suitability is computed from macros + portion (ADR-09).
    tags: text("tags").array().notNull().default([]),
    // Union of ingredient allergens, computed on import — never hand-set (FR-RECIPE-003).
    allergens: text("allergens").array().notNull().default([]),
    // Per-serving macros, computed from recipe_ingredients on import — never hand-set.
    kcalServing: numeric("kcal_serving", { precision: 7, scale: 2 }),
    proteinServing: numeric("protein_serving", { precision: 6, scale: 2 }),
    fatServing: numeric("fat_serving", { precision: 6, scale: 2 }),
    carbsServing: numeric("carbs_serving", { precision: 6, scale: 2 }),
  },
  (t) => [uniqueIndex("recipes_slug_key").on(t.slug)],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => canonicalIngredients.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    unit: text("unit").notNull(),
    optional: boolean("optional").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.ingredientId] })],
);

// ─── Relations (for the drizzle relational query API) ───────────────────────────

export const householdsRelations = relations(households, ({ many, one }) => ({
  members: many(householdMembers),
  restrictions: many(householdRestrictions),
  nutritionTargets: one(nutritionTargets, {
    fields: [households.id],
    references: [nutritionTargets.householdId],
  }),
  credentials: one(mcpCredentials, {
    fields: [households.id],
    references: [mcpCredentials.householdId],
  }),
  consumptionModel: one(consumptionModels, {
    fields: [households.id],
    references: [consumptionModels.householdId],
  }),
  preferences: one(householdPreferences, {
    fields: [households.id],
    references: [householdPreferences.householdId],
  }),
}));

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  household: one(households, {
    fields: [householdMembers.householdId],
    references: [households.id],
  }),
}));

export const householdRestrictionsRelations = relations(householdRestrictions, ({ one }) => ({
  household: one(households, {
    fields: [householdRestrictions.householdId],
    references: [households.id],
  }),
}));

export const consumptionModelsRelations = relations(consumptionModels, ({ one }) => ({
  household: one(households, {
    fields: [consumptionModels.householdId],
    references: [households.id],
  }),
}));

export const householdPreferencesRelations = relations(householdPreferences, ({ one }) => ({
  household: one(households, {
    fields: [householdPreferences.householdId],
    references: [households.id],
  }),
}));

export const recipesRelations = relations(recipes, ({ many }) => ({
  ingredients: many(recipeIngredients),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeIngredients.recipeId],
    references: [recipes.id],
  }),
  ingredient: one(canonicalIngredients, {
    fields: [recipeIngredients.ingredientId],
    references: [canonicalIngredients.id],
  }),
}));
