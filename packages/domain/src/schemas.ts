import { z } from "zod";

import { KCAL_FLOOR, macros100Schema, nutritionSourceSchema } from "./nutrition.js";
import { baseUnitSchema } from "./units.js";

/** API smoke procedure. */
export const helloResultSchema = z.object({
  message: z.string(),
  now: z.string().datetime(),
});
export type HelloResult = z.infer<typeof helloResultSchema>;

/** One row of a Silpo MCP `tools/list` response, trimmed for the UI. */
export const mcpToolSummarySchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
});
export type McpToolSummary = z.infer<typeof mcpToolSummarySchema>;

/** Result of `mcp.listTools` — the tool list, or a prompt to authenticate. */
export const mcpToolsResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), tools: z.array(mcpToolSummarySchema) }),
  z.object({ status: z.literal("auth_required"), hint: z.string() }),
]);
export type McpToolsResult = z.infer<typeof mcpToolsResultSchema>;

/** Per-serving macros as shown to the guest. */
export const servingMacrosSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  fat: z.number(),
  carbs: z.number(),
});
export type ServingMacros = z.infer<typeof servingMacrosSchema>;

/** A recipe as shown in a plan or the corpus browser. */
export const recipeSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  servings: z.number().int().positive(),
  totalMinutes: z.number().int().positive(),
  difficulty: z.number().int().min(1).max(3),
  tags: z.array(z.string()),
  allergens: z.array(z.string()),
  ingredients: z.array(z.string()),
  macros: servingMacrosSchema.nullable(),
});
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;

// ─── Goal mode & nutrition targets ─────────────────────────────────────────────

export const goalSchema = z.enum(["routine", "form"]);

export const nutritionComputedFromSchema = z.object({
  sex: z.enum(["male", "female"]),
  ageYears: z.number().int().positive(),
  weightKg: z.number().positive(),
  heightCm: z.number().positive(),
  activity: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  direction: z.enum(["gain", "maintain", "reduce"]),
});

/** `FR-GOAL-003` output. The `kcalTarget` floor is the third `FR-SAFE-009` checkpoint. */
export const nutritionTargetsSchema = z.object({
  proteinMinG: z.number().int().positive(),
  kcalTarget: z.number().int().min(KCAL_FLOOR, `kcal target must be at least ${KCAL_FLOOR}`),
  kcalTolerance: z.number().min(0).max(1).default(0.15),
  direction: z.enum(["gain", "maintain", "reduce"]),
  computedFrom: nutritionComputedFromSchema,
});
export type NutritionTargets = z.infer<typeof nutritionTargetsSchema>;

// ─── Canonical ingredient dictionary ──────────────────────────────────────────

/**
 * The EU-14 declarable allergens (`FR-SAFE-001`, `FR-RECIPE-003`). A recipe's allergen set
 * is the union of its ingredients' — computed, never hand-set. Extend this list only with
 * explicit sign-off: a missed allergen is a catastrophic failure.
 */
export const allergenSchema = z.enum([
  "gluten",
  "crustaceans",
  "egg",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "tree_nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
]);
export type Allergen = z.infer<typeof allergenSchema>;

/** Coarse ingredient category — also the head-noun hint the mapper passes to search (T2.1). */
export const ingredientCategorySchema = z.enum([
  "meat",
  "fish",
  "dairy_eggs",
  "vegetable",
  "fruit",
  "grain",
  "legume",
  "bakery",
  "pantry",
  "fat_oil",
  "spice_herb",
  "beverage",
  "other",
]);
export type IngredientCategory = z.infer<typeof ingredientCategorySchema>;

/**
 * One `canonical_ingredients` entry as authored in the dictionary data file
 * (`DATA-02`, TDD §3, roadmap T1.2). Runtime-validated by the importer and in a pure test —
 * so the TS data module gets the same discipline a YAML corpus would force.
 */
export const canonicalIngredientSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9_]+$/, "slug must be lower_snake_case"),
    nameUk: z.string().min(1),
    category: ingredientCategorySchema,
    baseUnit: baseUnitSchema,
    /** grams per millilitre — required to convert this ingredient between mass and volume. */
    densityGMl: z.number().positive().nullable().default(null),
    /** grams per piece — required to scale macros for a `pcs` ingredient (e.g. an egg). */
    gramsPerPiece: z.number().positive().nullable().default(null),
    allergens: z.array(allergenSchema).default([]),
    /** Simple head-noun forms for the mapper's query normalisation (M0 audit follow-up #1). */
    synonyms: z.array(z.string()).default([]),
    perishableDays: z.number().int().positive().nullable().default(null),
    per100g: macros100Schema.nullable().default(null),
    nutritionSrc: nutritionSourceSchema.nullable().default(null),
  })
  .refine(
    (e) => e.per100g == null || e.nutritionSrc != null,
    "nutritionSrc is required when per100g is set",
  )
  .refine(
    (e) => e.baseUnit !== "pcs" || e.gramsPerPiece != null || e.per100g == null,
    "a pcs ingredient with macros needs gramsPerPiece",
  );
/** Post-parse shape (optional fields resolved to their defaults). */
export type CanonicalIngredientSeed = z.infer<typeof canonicalIngredientSchema>;
/** Authoring shape for the data file — optional fields may be omitted. */
export type CanonicalIngredientInput = z.input<typeof canonicalIngredientSchema>;

// ─── Recipe corpus (authoring schema for data/recipes/*.yaml) ──────────────────

/**
 * The meal slot a recipe fills (`FR-RECIPE-002`). The P0 demo plans 5 dinners, but the
 * corpus also carries breakfast / lunch entries.
 */
export const recipeMealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type RecipeMealType = z.infer<typeof recipeMealTypeSchema>;

/** Season fit (`FR-RECIPE-002`; `FR-RECIPE-005` wants ≥ 1). `all_year` = no seasonal bias. */
export const recipeSeasonSchema = z.enum(["spring", "summer", "autumn", "winter", "all_year"]);
export type RecipeSeason = z.infer<typeof recipeSeasonSchema>;

/**
 * Dietary + practical recipe tags (`FR-RECIPE-002`). Deliberately **no `fitness` tag** —
 * `form`-mode suitability is computed from macros + portion, never declared (ADR-09). The
 * dietary tags here are author hints for filtering / display; the authoritative allergen
 * set is always the computed ingredient union (`FR-RECIPE-003`).
 */
export const recipeTagSchema = z.enum([
  "vegetarian",
  "vegan",
  "lenten", // пісне
  "gluten_free",
  "lactose_free",
  "kids_friendly",
  "reheatable",
  "quick",
  "one_pot",
  "budget",
]);
export type RecipeTag = z.infer<typeof recipeTagSchema>;

/** One ingredient line of a recipe — a reference into the `CanonicalIngredient` dictionary. */
export const recipeIngredientRefSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9_]+$/, "slug must be lower_snake_case"),
    amount: z.number().positive(),
    unit: z.enum(["g", "ml", "pcs", "kg", "l"]),
    optional: z.boolean().default(false),
  })
  .strict();
export type RecipeIngredientRef = z.infer<typeof recipeIngredientRefSchema>;

/**
 * One recipe as authored in `data/recipes/<slug>.yaml` (`DATA-02`, `FR-RECIPE-001/002`,
 * roadmap T1.3). `.strict()` — `allergens` and per-serving macros are **never** authored
 * here; `import-recipes.ts` computes them from the ingredient union and `recipeMacros`
 * (`FR-RECIPE-003`, `.claude/rules/food-safety.md`). Runtime-validated by the importer and
 * a pure corpus test — the same discipline `canonicalIngredientSchema` gives the dictionary.
 */
export const recipeSeedSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9_]+$/, "slug must be lower_snake_case"),
    titleUk: z.string().min(1),
    servings: z.number().int().positive(),
    activeMinutes: z.number().int().positive(),
    totalMinutes: z.number().int().positive(),
    difficulty: z.number().int().min(1).max(3),
    mealType: recipeMealTypeSchema,
    seasons: z.array(recipeSeasonSchema).min(1),
    tags: z.array(recipeTagSchema).default([]),
    steps: z.array(z.string().min(1)).min(1),
    ingredients: z.array(recipeIngredientRefSchema).min(1),
  })
  .strict()
  .refine((r) => r.totalMinutes >= r.activeMinutes, {
    message: "totalMinutes must be >= activeMinutes",
    path: ["totalMinutes"],
  })
  .refine((r) => new Set(r.ingredients.map((i) => i.slug)).size === r.ingredients.length, {
    message: "duplicate ingredient slug in one recipe",
    path: ["ingredients"],
  });
/** Post-parse shape (defaults resolved). */
export type RecipeSeed = z.infer<typeof recipeSeedSchema>;
/** Authoring shape for a YAML file — optional fields (`optional`, `tags`) may be omitted. */
export type RecipeSeedInput = z.input<typeof recipeSeedSchema>;

// ─── LLM step contracts (TDD §6) ──────────────────────────────────────────────

/**
 * Input to the `explainPlan` LLM step (TDD §6): the finished plan's headline numbers.
 * PII is stripped by the harness before send (`INT-LLM-004`); this shape carries none.
 * The deterministic fallback is a template — see `@navar/llm`.
 */
export const explainPlanInputSchema = z.object({
  days: z.number().int().positive(),
  budgetUah: z.number().nonnegative(),
  totalUah: z.number().nonnegative(),
  savingsUah: z.number(),
  promoSharePct: z.number().min(0).max(100),
  goal: goalSchema,
  dishes: z.array(z.string()).max(40),
});
export type ExplainPlanInput = z.infer<typeof explainPlanInputSchema>;

/**
 * `explainChange` input (T4.2, `FR-PLAN-008`) — a plan **edit**, not a snapshot. Kept
 * separate from `ExplainPlanInput` because that shape has no before/after and so cannot
 * express what changed. PII-free by construction (dish titles and numbers only).
 */
export const explainChangeInputSchema = z.object({
  kind: z.enum(["replace_item", "cheaper"]),
  goal: goalSchema,
  budgetBeforeUah: z.number().nonnegative(),
  budgetAfterUah: z.number().nonnegative(),
  totalBeforeUah: z.number().nonnegative(),
  totalAfterUah: z.number().nonnegative(),
  removedDishes: z.array(z.string()).max(40),
  addedDishes: z.array(z.string()).max(40),
  changedDays: z.array(z.number().int().positive()).max(40),
  promoSharePctBefore: z.number().min(0).max(100),
  promoSharePctAfter: z.number().min(0).max(100),
});
export type ExplainChangeInput = z.infer<typeof explainChangeInputSchema>;

/** `explainPlan` output — a short guest-facing paragraph (`ADR-02`: the LLM only explains). */
export const explainPlanOutputSchema = z.object({
  text: z.string().min(1).max(600),
});
export type ExplainPlanOutput = z.infer<typeof explainPlanOutputSchema>;
