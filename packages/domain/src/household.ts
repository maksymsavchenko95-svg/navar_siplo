import { z } from "zod";

import { allergenSchema, goalSchema } from "./schemas.js";

/**
 * Household-domain vocabulary (ADR-01): the raw Silpo MCP reads, the derived
 * `ConsumptionModel` + `HouseholdPreferences`, the restriction dictionary, the LLM step
 * I/O, and the guest-facing portrait (`FR-HH-001..004`, `AC-P0-02`, roadmap T1.4).
 *
 * **PII-free by construction.** Every type here is produced by a `@navar/retail`
 * `silpo/parse.ts` mapper that drops names, phones, emails, exact addresses, and receipt
 * URLs at the package boundary (`INT-LLM-004`). Nothing in this file — nor anything reaching
 * an LLM step — carries personal data. The one exception is `parseRestrictionsInput.phrases`
 * (guest-authored free text), which `runStep` still passes through `redact()`.
 */

// ─── Raw retail reads (already PII-stripped by the mappers) ────────────────────

export const retailProfileSchema = z.object({
  /** Opaque Silpo account id — the value stored in `households.silpo_user_ref`, never the phone. */
  silpoProfileId: z.string(),
  gender: z.string().nullable(),
  /** Year only — the mapper derives it from `birthday` and discards the date. */
  birthYear: z.number().int().nullable(),
});
export type RetailProfile = z.infer<typeof retailProfileSchema>;

export const retailFamilySchema = z.object({
  adultCount: z.number().int().nonnegative(),
  childAgeYears: z.array(z.number().int().nonnegative()),
  petCount: z.number().int().nonnegative(),
  itsMeProfileId: z.string().nullable(),
});
export type RetailFamily = z.infer<typeof retailFamilySchema>;

/** One `silpo_get_my_food_restrictions` entry, flattened to free text for `parseRestrictions`. */
export const rawRestrictionSchema = z.object({
  slug: z.string(),
  text: z.string(),
});
export type RawRestriction = z.infer<typeof rawRestrictionSchema>;

export const retailAddressSchema = z.object({
  id: z.string(),
  tag: z.string().nullable(),
  /** City survives redaction — it's the branch/region signal, not a home identifier. */
  city: z.string(),
});
export type RetailAddress = z.infer<typeof retailAddressSchema>;

/** One purchased line, normalised across online + offline order shapes. */
export const retailLineSchema = z.object({
  /** Stable aggregation key: ingredient slug, else `lager:<id>`, else `name:<name>`. */
  key: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  unitPrice: z.number(),
  quantity: z.number(), // can be negative — a void/return
  lineTotal: z.number(),
  unit: z.string().nullable(),
  catalogProductId: z.string().nullable(),
});
export type RetailLine = z.infer<typeof retailLineSchema>;

export const retailOrderSchema = z.object({
  source: z.enum(["online", "offline"]),
  externalId: z.string(),
  /** ISO-8601 UTC. Offline orders arrive naive (no offset) and get a `Z` appended. */
  createdAt: z.string(),
  total: z.number(),
  discount: z.number(),
  lines: z.array(retailLineSchema),
});
export type RetailOrder = z.infer<typeof retailOrderSchema>;

export const retailFavoriteSchema = z.object({
  productId: z.string(),
  slug: z.string(),
  name: z.string(),
  price: z.number(),
  available: z.boolean(),
  companyId: z.string(),
  branchId: z.string().nullable(),
});
export type RetailFavorite = z.infer<typeof retailFavoriteSchema>;

// ─── Consumption model (derived, deterministic — ADR-02) ───────────────────────

export const buyFrequencySchema = z.object({
  key: z.string(),
  label: z.string(),
  category: z.string().nullable(),
  buysPer4Weeks: z.number().nonnegative(),
  avgQuantity: z.number().nonnegative(),
  unit: z.string().nullable(),
  lastBoughtDaysAgo: z.number().int().nonnegative().nullable(),
  orderShare: z.number().min(0).max(1),
});
export type BuyFrequency = z.infer<typeof buyFrequencySchema>;

export const brandAffinitySchema = z.object({
  brand: z.string(),
  category: z.string().nullable(),
  purchases: z.number().int().positive(),
  categoryShare: z.number().min(0).max(1),
});
export type BrandAffinity = z.infer<typeof brandAffinitySchema>;

export const consumptionModelSchema = z.object({
  source: z.enum(["receipts", "onboarding"]),
  orderCount: z.number().int().nonnegative(),
  window: z.object({ start: z.string(), end: z.string() }).nullable(),
  medianWeeklyChequeUah: z.number().nonnegative().nullable(),
  /** Sorted desc by `buysPer4Weeks`. */
  buyFrequency: z.array(buyFrequencySchema),
  /** Sorted desc by `purchases`. */
  brandAffinity: z.array(brandAffinitySchema),
});
export type ConsumptionModel = z.infer<typeof consumptionModelSchema>;

export const householdPreferencesSchema = z.object({
  weeklyBudgetUah: z.number().nonnegative().nullable(),
  /** Canonical ingredient slugs. */
  dislikedIngredients: z.array(z.string()),
  maxPrepMinutes: z.number().int().positive().nullable(),
  cookingWeekdays: z.array(z.number().int().min(0).max(6)),
  difficultyCap: z.number().int().min(1).max(3).nullable(),
  source: z.enum(["onboarding", "inferred", "guest"]),
});
export type HouseholdPreferences = z.infer<typeof householdPreferencesSchema>;

// ─── Restriction dictionary ───────────────────────────────────────────────────

export const restrictionKindSchema = z.enum(["allergen", "diet", "dislike"]);
export type RestrictionKind = z.infer<typeof restrictionKindSchema>;

export const restrictionSeveritySchema = z.enum(["strict", "soft"]);
export type RestrictionSeverity = z.infer<typeof restrictionSeveritySchema>;

export const restrictionSourceSchema = z.enum(["mcp", "onboarding", "inferred", "guest"]);
export type RestrictionSource = z.infer<typeof restrictionSourceSchema>;

/**
 * Diet codes for `household_restrictions` (`kind='diet'`). Allergen codes reuse the EU-14
 * `allergenSchema`; `dislike` codes are canonical ingredient slugs.
 * ⚠ Vocabulary needs product sign-off (which diets P0 supports; halal/kosher severity).
 */
export const dietCodeSchema = z.enum([
  "vegetarian",
  "vegan",
  "pescatarian",
  "halal",
  "kosher",
  "lactose_free",
  "gluten_free",
  "dairy_free",
  "low_carb",
  "keto",
  "no_pork",
  "no_beef",
  "no_sugar",
]);
export type DietCode = z.infer<typeof dietCodeSchema>;

/**
 * The LLM's parsed restriction (`parseRestrictions`, TDD §6). Discriminated on `kind` so
 * the `code` vocabulary is enforced at parse time, not trusted from the prompt
 * (`.claude/rules/food-safety.md` rule 1): an `allergen` code MUST be an EU-14
 * `allergenSchema` value, a `diet` code MUST be a `dietCodeSchema` value. A model that
 * emits `"lactose"` / `"dairy"` for `kind:"allergen"` now fails validation and `runStep`
 * falls back to the deterministic keyword dictionary (`INT-LLM-003`), instead of persisting
 * a code that `resolveExclusions` would silently drop.
 */
const parsedRestrictionBase = {
  severity: restrictionSeveritySchema,
  /** The input phrase this was derived from — kept for the audit trail and the UI. */
  sourceText: z.string(),
};
export const parsedRestrictionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allergen"), code: allergenSchema, ...parsedRestrictionBase }),
  z.object({ kind: z.literal("diet"), code: dietCodeSchema, ...parsedRestrictionBase }),
  z.object({ kind: z.literal("dislike"), code: z.string().min(1), ...parsedRestrictionBase }),
]);
export type ParsedRestriction = z.infer<typeof parsedRestrictionSchema>;

/** A restriction as stored + read back (`household_restrictions` row + `confirmedAt`). */
export const storedRestrictionSchema = z.object({
  kind: restrictionKindSchema,
  code: z.string(),
  severity: restrictionSeveritySchema,
  source: restrictionSourceSchema,
  confirmed: z.boolean(),
});
export type StoredRestriction = z.infer<typeof storedRestrictionSchema>;

// ─── LLM step I/O (TDD §6) ────────────────────────────────────────────────────

export const parseRestrictionsInputSchema = z.object({
  phrases: z.array(z.string()).max(50),
});
export type ParseRestrictionsInput = z.infer<typeof parseRestrictionsInputSchema>;

export const parseRestrictionsOutputSchema = z.object({
  restrictions: z.array(parsedRestrictionSchema),
});
export type ParseRestrictionsOutput = z.infer<typeof parseRestrictionsOutputSchema>;

/** Aggregated purchase summary — the deterministic model, PII-free, sent to `inferConsumption`. */
export const inferConsumptionInputSchema = z.object({
  orderCount: z.number().int().nonnegative(),
  weeks: z.number().int().nonnegative(),
  topItems: z
    .array(
      z.object({
        label: z.string(),
        buysPer4Weeks: z.number().nonnegative(),
        category: z.string().nullable(),
      }),
    )
    .max(25),
  topBrands: z.array(z.object({ brand: z.string(), category: z.string().nullable() })).max(15),
  medianWeeklyChequeUah: z.number().nullable(),
});
export type InferConsumptionInput = z.infer<typeof inferConsumptionInputSchema>;

export const consumptionTagSchema = z.enum([
  "batch_cooks",
  "organic_leaning",
  "budget_conscious",
  "premium_leaning",
  "quick_meals",
  "fresh_produce_heavy",
  "meat_heavy",
  "plant_leaning",
  "convenience_foods",
  "brand_loyal",
]);
export type ConsumptionTag = z.infer<typeof consumptionTagSchema>;

export const inferConsumptionOutputSchema = z.object({
  tags: z.array(consumptionTagSchema).max(6),
  /** Ukrainian, 1–2 sentences, observation only — no medical / dietary-advice language. */
  summary: z.string().min(1).max(400),
});
export type InferConsumptionOutput = z.infer<typeof inferConsumptionOutputSchema>;

// ─── Portrait + confirm (FR-HH-004) ───────────────────────────────────────────

export const tasteCardSchema = z.object({
  /** Stable key for `confirmTastes` diffs. */
  id: z.string(),
  kind: z.enum(["often_bought", "rarely_bought", "allergy", "dislike", "diet"]),
  label: z.string(),
  detail: z.string().nullable(),
  code: z.string().nullable(),
  severity: restrictionSeveritySchema.nullable(),
  source: z.enum(["receipts", "mcp", "inferred", "onboarding", "guest"]),
  confirmed: z.boolean(),
});
export type TasteCard = z.infer<typeof tasteCardSchema>;

export const householdPortraitSchema = z.object({
  /** Always true — every inference is shown to the guest as an assumption (`FR-HH-004`). */
  isAssumption: z.literal(true),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  oftenBought: z.array(tasteCardSchema),
  rarelyBought: z.array(tasteCardSchema),
  allergies: z.array(tasteCardSchema),
});
export type HouseholdPortrait = z.infer<typeof householdPortraitSchema>;

export const confirmTastesInputSchema = z.object({
  edits: z
    .array(
      z.discriminatedUnion("action", [
        z.object({ action: z.literal("accept"), id: z.string() }),
        z.object({ action: z.literal("reject"), id: z.string() }),
        z.object({
          action: z.literal("add"),
          kind: restrictionKindSchema,
          code: z.string().min(1),
          severity: restrictionSeveritySchema,
        }),
        z.object({
          action: z.literal("edit"),
          id: z.string(),
          severity: restrictionSeveritySchema,
        }),
      ]),
    )
    .max(50),
});
export type ConfirmTastesInput = z.infer<typeof confirmTastesInputSchema>;

// ─── Onboarding fallback (FR-HH-003, ≤ 6 questions) ───────────────────────────

export const onboardingAnswersSchema = z.object({
  weeklyBudgetUah: z.number().positive().nullable(),
  adults: z.number().int().min(1).max(12),
  children: z.array(z.number().int().min(0).max(18)).max(12),
  restrictionPhrases: z.array(z.string()).max(20),
  dislikedPhrases: z.array(z.string()).max(20),
  cookingWeekdays: z.array(z.number().int().min(0).max(6)),
  maxPrepMinutes: z.number().int().min(5).max(180).nullable(),
});
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

// ─── household.get result (discriminated — pattern: recipeShoppingResultSchema) ─

export const bootstrapStatusSchema = z.enum([
  "idle",
  "running",
  "onboarding_required",
  "done",
  "error",
]);
export type BootstrapStatus = z.infer<typeof bootstrapStatusSchema>;

export const memberSourceSchema = z.enum(["silpo", "guest"]);
export type MemberSource = z.infer<typeof memberSourceSchema>;

export const householdMemberSchema = z.object({
  kind: z.enum(["adult", "child", "pet"]),
  ageYears: z.number().int().nullable(),
  label: z.string().nullable(),
  // `.default` keeps pre-R5 constructors (tests, fixtures) valid without a `source`.
  source: memberSourceSchema.default("silpo"),
});
export type HouseholdMemberView = z.infer<typeof householdMemberSchema>;

export const householdResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    household: z.object({
      id: z.string().uuid(),
      goal: goalSchema,
      weeklyBudgetUah: z.number().nullable(),
      branchId: z.string().nullable(),
      deliveryType: z.string().nullable(),
      bootstrapStatus: bootstrapStatusSchema,
      // `form` goal only — the daily protein floor / kcal corridor from `nutrition_targets`,
      // for the guest-facing "what am I generating for" summary (`/plan`). `null` until
      // `household.computeNutrition` has run once.
      nutritionTargets: z
        .object({ kcalTarget: z.number().int(), proteinMinG: z.number().int() })
        .nullable(),
    }),
    members: z.array(householdMemberSchema),
    restrictions: z.array(storedRestrictionSchema),
    consumptionModel: consumptionModelSchema.nullable(),
    preferences: householdPreferencesSchema.nullable(),
  }),
  z.object({ status: z.literal("not_bootstrapped") }),
]);
export type HouseholdResult = z.infer<typeof householdResultSchema>;

// ─── household.setMembers (R5 — the Guest's household-size override) ───────────

/**
 * Counts, not an age array — children are count-only in P0 (`submitOnboarding.children` is
 * an age array; the two "children" shapes coexist deliberately). Bounds match
 * `onboardingAnswersSchema` (adults 1–12, children ≤ 12).
 */
export const setMembersInputSchema = z.object({
  adults: z.number().int().min(1).max(12),
  children: z.number().int().min(0).max(12),
});
export type SetMembersInput = z.infer<typeof setMembersInputSchema>;

export const setMembersResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), members: z.array(householdMemberSchema) }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type SetMembersResult = z.infer<typeof setMembersResultSchema>;
