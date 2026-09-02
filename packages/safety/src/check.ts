import type { Allergen, IngredientCategory, ProductDetails } from "@navar/domain";

import { mapSkuAllergens } from "./allergens.js";
import type { Exclusions } from "./restrictions.js";

/**
 * The outcome of a safety check. `safe:false` is fail-closed — a `blocked_unsafe` line in
 * the plan / a rejected cart add, non-overridable. `source` distinguishes the layer that
 * caught it (for the `[safety]` log and the golden dataset).
 */
export type SafetyVerdict =
  | { safe: true }
  | {
      safe: false;
      source: "ingredient" | "sku" | "sku_unknown";
      allergens: Allergen[];
      reason: string;
    };

/** Guest-facing Ukrainian labels — non-medical (`FR-SAFE-008`). */
export const ALLERGEN_LABEL_UK: Record<Allergen, string> = {
  gluten: "глютен",
  crustaceans: "ракоподібні",
  egg: "яйця",
  fish: "риба",
  peanuts: "арахіс",
  soybeans: "соя",
  milk: "молоко",
  tree_nuts: "горіхи",
  celery: "селера",
  mustard: "гірчиця",
  sesame: "кунжут",
  sulphites: "сульфіти",
  lupin: "люпин",
  molluscs: "молюски",
};

/**
 * Ingredient categories where a **processed / branded** SKU can plausibly carry a declared
 * allergen that the raw `CanonicalIngredient` does not list (sauces & pantry staples, baked
 * goods, spice blends with anti-caking agents). A chosen SKU gets a `get_product_details`
 * SKU-level check only when its category is here for one of the household's allergens —
 * deliberately narrow so a plain-meat / produce / dairy card missing its composition
 * doesn't fail-close a whole plan (raw chicken is not a gluten vector).
 */
export const ALLERGEN_RISK_CATEGORIES: Record<Allergen, readonly IngredientCategory[]> = {
  gluten: ["pantry", "bakery", "spice_herb"],
  milk: ["pantry", "bakery", "spice_herb"],
  egg: ["pantry", "bakery"],
  soybeans: ["pantry", "spice_herb"],
  sesame: ["pantry", "bakery", "spice_herb"],
  mustard: ["pantry", "spice_herb"],
  celery: ["pantry", "spice_herb"],
  sulphites: ["pantry", "beverage"],
  tree_nuts: ["pantry", "bakery"],
  peanuts: ["pantry", "bakery"],
  fish: ["pantry"],
  crustaceans: ["pantry"],
  molluscs: ["pantry"],
  lupin: ["pantry", "bakery"],
};

const intersect = <T>(a: readonly T[], b: readonly T[]): T[] => a.filter((x) => b.includes(x));

function allergenList(codes: readonly Allergen[]): string {
  return codes.map((c) => ALLERGEN_LABEL_UK[c]).join(", ");
}

/** True when a chosen SKU in `category` warrants a `get_product_details` safety fetch. */
export function needsSkuCheck(category: IngredientCategory, exclusions: Exclusions): boolean {
  return exclusions.allergens.some((a) => ALLERGEN_RISK_CATEGORIES[a].includes(category));
}

/**
 * `CanonicalIngredient`-level check, run at planning time (`FR-SAFE-002` first pass). This
 * is the authoritative layer — the M0 audit found SKU composition on only ~22% of cards.
 */
export function checkIngredient(args: {
  slug: string;
  allergens: readonly string[];
  exclusions: Exclusions;
}): SafetyVerdict {
  const { slug, allergens, exclusions } = args;

  if (exclusions.ingredients.includes(slug)) {
    return {
      safe: false,
      source: "ingredient",
      allergens: [],
      reason: "Не додано: ця позиція у вашому списку виключень.",
    };
  }

  const hit = intersect(allergens as Allergen[], exclusions.allergens);
  if (hit.length > 0) {
    return {
      safe: false,
      source: "ingredient",
      allergens: hit,
      reason: `Не додано: містить алерген (${allergenList(hit)}). Перевірте упаковку самостійно.`,
    };
  }

  return { safe: true };
}

/**
 * SKU-level check via `silpo_get_product_details`, run before a SKU is accepted
 * (`FR-SAFE-002` second pass). Best-effort but **fail-closed** (ADR-05): a matched allergen,
 * an unmappable token, or missing composition next to a declared allergy → block.
 */
export function checkSku(args: { details: ProductDetails; exclusions: Exclusions }): SafetyVerdict {
  const { details, exclusions } = args;
  if (exclusions.allergens.length === 0) return { safe: true };

  const { codes, unknown } = mapSkuAllergens(details.allergens);

  const hit = intersect(codes, exclusions.allergens);
  if (hit.length > 0) {
    return {
      safe: false,
      source: "sku",
      allergens: hit,
      reason: `Не додано: у складі вказано алерген (${allergenList(hit)}). Перевірте упаковку самостійно.`,
    };
  }

  const noData = details.allergens.length === 0 && details.composition == null;
  const ambiguous = unknown.length > 0;
  const strictGap = exclusions.strictMode && details.composition == null;
  if (noData || ambiguous || strictGap) {
    return {
      safe: false,
      source: "sku_unknown",
      allergens: exclusions.allergens,
      reason:
        `Не додано: склад цього товару невідомий або неоднозначний, ` +
        `а вказано алергію (${allergenList(exclusions.allergens)}).`,
    };
  }

  return { safe: true };
}

/** A blocked verdict raised as an error — the throwing path for the cart write (T3.1). */
export class SafetyError extends Error {
  constructor(readonly verdict: Extract<SafetyVerdict, { safe: false }>) {
    super(verdict.reason);
    this.name = "SafetyError";
  }
}

export function assertIngredientSafe(args: {
  slug: string;
  allergens: readonly string[];
  exclusions: Exclusions;
}): void {
  const v = checkIngredient(args);
  if (!v.safe) throw new SafetyError(v);
}

export function assertSkuSafe(args: { details: ProductDetails; exclusions: Exclusions }): void {
  const v = checkSku(args);
  if (!v.safe) throw new SafetyError(v);
}
