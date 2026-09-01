import { z } from "zod";

import { KCAL_FLOOR } from "./nutrition.js";

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
