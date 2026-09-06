import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
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

// ─── Consumption ───────────────────────────────────────────────────────────────

/**
 * Raw purchased lines from `silpo_get_my_online_orders` / `_offline_orders`, retained per
 * household (`FR-HH-002`, `ASM-01`, TDD §3, roadmap T1.6). The replayable source that
 * `buildConsumptionModel` and P1 pantry inference sit on — bootstrap otherwise keeps only
 * the aggregated `consumption_models.model` JSON.
 *
 * Written by `household.bootstrap` as delete-by-household + bulk insert, so a re-bootstrap
 * re-derives `ingredient_id` rather than leaving it stale. `ingredient_id` is a best-effort
 * deterministic link (synonym / `name_uk` phrase match) — null when not confidently
 * derivable; the T2.1 mapper backfills the rest. PII-free: `silpo/parse.ts` drops names /
 * addresses / receipt URLs at the package boundary (`INT-LLM-004`, `CON-05`).
 */
export const receiptLines = pgTable(
  "receipt_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // online | offline
    orderExternalId: text("order_external_id").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    rawName: text("raw_name").notNull(),
    // RetailLine.key — the stable aggregation key, joins to consumption_models buyFrequency.
    aggKey: text("agg_key").notNull(),
    productRef: text("product_ref"), // Silpo catalogProduct.id (online + offline)
    catalogSlug: text("catalog_slug"), // Silpo catalogProduct.slug (offline only)
    quantity: numeric("quantity", { precision: 10, scale: 3 }), // negative = void / return
    unit: text("unit"),
    price: numeric("price", { precision: 10, scale: 2 }), // RetailLine.unitPrice
    ingredientId: uuid("ingredient_id").references(() => canonicalIngredients.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    index("receipt_lines_household_purchased_idx").on(t.householdId, t.purchasedAt.desc()),
    index("receipt_lines_ingredient_idx").on(t.ingredientId),
  ],
);

// ─── Plans (TDD §3, roadmap T2.4) ──────────────────────────────────────────────

/**
 * A generated meal plan — the persisted form of `@navar/planner`'s `SolverResult`
 * (`FR-PLAN-*`, `AC-P0-03/09`). `seed` + `budget_uah` + `goal` are the reproducibility
 * key. Only feasible plans are stored; the infeasible verdict is returned inline by
 * `plan.generate` (T2.5 will persist a nearest plan). Header numbers are snapshots — the
 * corpus and live prices move on. `explanation` is the `explainPlan` LLM step's output
 * (T2.6), always populated via the template fallback.
 */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(), // routine | form — snapshot (households.goal can change)
    seed: bigint("seed", { mode: "number" }).notNull(),
    days: integer("days").notNull(),
    budgetUah: numeric("budget_uah", { precision: 10, scale: 2 }).notNull(),
    status: text("status").notNull().default("draft"), // draft|confirmed|materialized|checked_out
    totalEstUah: numeric("total_est_uah", { precision: 10, scale: 2 }),
    promoShare: numeric("promo_share", { precision: 4, scale: 3 }), // 0..1
    estimatedCostUah: numeric("estimated_cost_uah", { precision: 10, scale: 2 }), // F3
    unpricedLineCount: integer("unpriced_line_count").notNull().default(0), // F3
    proteinFloorMet: boolean("protein_floor_met"),
    kcalCorridorMet: boolean("kcal_corridor_met"), // F4 — against the TRUE corridor
    explanation: text("explanation"), // T2.6
    /** Who wrote `explanation`: `llm` | `fallback` — so a dead key is visible in the data. */
    explanationSource: text("explanation_source"),
    cartId: text("cart_id"), // T3.1 — the Silpo shoppingCartId this plan was materialized into
    materializedAt: timestamp("materialized_at", { withTimezone: true }), // T3.1
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plans_household_created_idx").on(t.householdId, t.createdAt.desc())],
);

/**
 * One dinner of a plan. `recipe_id` is nullable + `ON DELETE SET NULL` — `import-recipes.ts`
 * prunes removed recipes, and a pruned recipe must not break an old plan or block a
 * re-import. `slug` / `title_uk` / per-serving macros are snapshots so the row renders
 * without the recipe row.
 */
export const planItems = pgTable(
  "plan_items",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    dayIndex: integer("day_index").notNull(),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    titleUk: text("title_uk").notNull(),
    servings: integer("servings").notNull(),
    portionScale: numeric("portion_scale", { precision: 3, scale: 2 }).notNull().default("1.00"), // T3.3
    costUah: numeric("cost_uah", { precision: 10, scale: 2 }).notNull(),
    promoShareUah: numeric("promo_share_uah", { precision: 10, scale: 2 }).notNull(),
    kcalServing: numeric("kcal_serving", { precision: 7, scale: 2 }),
    proteinServing: numeric("protein_serving", { precision: 6, scale: 2 }),
    fatServing: numeric("fat_serving", { precision: 6, scale: 2 }),
    carbsServing: numeric("carbs_serving", { precision: 6, scale: 2 }),
    pinned: boolean("pinned").notNull().default(false),
    outcome: text("outcome"), // cooked | skipped | null
  },
  (t) => [primaryKey({ columns: [t.planId, t.dayIndex] })],
);

/**
 * The shopping list — one line per consolidated `CanonicalIngredient` the plan's dinners
 * need, with its resolved Silpo SKU (the T2.1 mapper's output for the chosen recipes only).
 * `ingredient_id` is `ON DELETE RESTRICT` like `receipt_lines` (ingredients are never
 * pruned). Carries the mapper's decision + confidence + flags so the cart step (T3.1) and
 * the web screen can show what needs the Guest's attention.
 */
export const listLines = pgTable(
  "list_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => canonicalIngredients.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    nameUk: text("name_uk").notNull(),
    neededAmount: numeric("needed_amount", { precision: 10, scale: 2 }).notNull(),
    unit: text("unit").notNull(),
    productRef: text("product_ref"), // ProductMatch.productId
    externalProductId: text("external_product_id"),
    companyId: text("company_id"),
    branchId: text("branch_id"),
    productName: text("product_name"),
    packSize: numeric("pack_size", { precision: 10, scale: 2 }),
    packCount: integer("pack_count").notNull().default(0),
    price: numeric("price", { precision: 10, scale: 2 }),
    oldPrice: numeric("old_price", { precision: 10, scale: 2 }), // pre-promo — for the savings figure
    isPromo: boolean("is_promo").notNull().default(false),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    decision: text("decision"), // accepted|reranked|needs_confirmation|no_match|replacement|blocked_unsafe
    needsConfirmation: boolean("needs_confirmation").notNull().default(false),
    outOfStock: boolean("out_of_stock").notNull().default(false), // F5
    blockReason: text("block_reason"),
    userOverridden: boolean("user_overridden").notNull().default(false), // learning signal (TDD)
  },
  (t) => [index("list_lines_plan_idx").on(t.planId)],
);

// ─── Observability (TDD §8 day 9, roadmap T4.3, FR-OPS-001) ────────────────────

/**
 * One recorded JSON-RPC MCP call — tool, duration, status, correlation id (`FR-OPS-001`,
 * `AC-P0-08`). Written best-effort after a `runWithMcpTrace` scope closes (`@navar/retail`
 * `trace.ts`); read back by `ops.trace(planId)` for the demo. `plan_id` scopes a plan's
 * generate / cart flows; `bootstrap` rows carry only `household_id`. PII-free: `args` is a
 * redacted request summary, the response body is never stored.
 */
export const mcpCallLog = pgTable(
  "mcp_call_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    correlationId: text("correlation_id").notNull(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "set null" }),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(), // plan_generate | cart_* | bootstrap | other
    tool: text("tool").notNull(),
    args: jsonb("args"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    attempts: integer("attempts").notNull().default(1), // 0 = served from cache
    cached: boolean("cached").notNull().default(false),
    status: text("status").notNull(), // ok | error
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    resultBytes: integer("result_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mcp_call_log_plan_idx").on(t.planId, t.startedAt),
    index("mcp_call_log_correlation_idx").on(t.correlationId),
  ],
);

// ─── Relations (for the drizzle relational query API) ───────────────────────────

export const householdsRelations = relations(households, ({ many, one }) => ({
  members: many(householdMembers),
  restrictions: many(householdRestrictions),
  receiptLines: many(receiptLines),
  plans: many(plans),
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

export const receiptLinesRelations = relations(receiptLines, ({ one }) => ({
  household: one(households, {
    fields: [receiptLines.householdId],
    references: [households.id],
  }),
  ingredient: one(canonicalIngredients, {
    fields: [receiptLines.ingredientId],
    references: [canonicalIngredients.id],
  }),
}));

export const plansRelations = relations(plans, ({ many, one }) => ({
  household: one(households, {
    fields: [plans.householdId],
    references: [households.id],
  }),
  items: many(planItems),
  list: many(listLines),
}));

export const planItemsRelations = relations(planItems, ({ one }) => ({
  plan: one(plans, { fields: [planItems.planId], references: [plans.id] }),
  recipe: one(recipes, { fields: [planItems.recipeId], references: [recipes.id] }),
}));

export const listLinesRelations = relations(listLines, ({ one }) => ({
  plan: one(plans, { fields: [listLines.planId], references: [plans.id] }),
  ingredient: one(canonicalIngredients, {
    fields: [listLines.ingredientId],
    references: [canonicalIngredients.id],
  }),
}));
