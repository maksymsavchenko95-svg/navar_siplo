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

/** `explainPlan` output — a short guest-facing paragraph (`ADR-02`: the LLM only explains). */
export const explainPlanOutputSchema = z.object({
  text: z.string().min(1).max(600),
});
export type ExplainPlanOutput = z.infer<typeof explainPlanOutputSchema>;
