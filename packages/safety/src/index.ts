/**
 * @navar/safety — food-safety guardrails. Deterministic, fail-closed (ADR-05, ADR-02).
 * Nothing enters a plan or the cart without a code check against the household's
 * restrictions, run twice (`FR-SAFE-002`): at the `CanonicalIngredient` level during
 * planning (`checkIngredient` — authoritative), and at the concrete SKU level via
 * `silpo_get_product_details` before add-to-cart (`checkSku` — best-effort, fail-closed).
 * Unknown / ambiguous composition + a declared allergy → block. Replacements get the same
 * check (`FR-SAFE-004`). Never a prompt.
 *
 * Spec: SRS §6.8 (`FR-SAFE-001..008`), TDD §5 step 5. The M0 audit found SKU composition on
 * only ~22% of cards, so the ingredient-level union check is the real protection and the
 * SKU check is a fail-closed second layer, run only for allergen-risk categories.
 *
 * ── Calorie floor (`FR-SAFE-009`) ─────────────────────────────────────────────
 * A `form` household's `kcal_target` can never sit below `KCAL_FLOOR`. Enforced fail-closed
 * in three places kept in sync — `assertKcalFloor` (re-exported here), the
 * `nutritionTargetsSchema` refine, and the `nutrition_targets` DB CHECK.
 *
 * `form` is a preference / goal, never a treatment — no medical diets or terminology
 * (`CON-04`, `FR-SAFE-008`).
 */

export { assertKcalFloor, KcalFloorError } from "@navar/domain";

export { normalizeAllergenToken, mapSkuAllergens } from "./allergens.js";
export { resolveExclusions, hasHardExclusion, type Exclusions } from "./restrictions.js";
export {
  type SafetyVerdict,
  ALLERGEN_LABEL_UK,
  ALLERGEN_RISK_CATEGORIES,
  needsSkuCheck,
  checkIngredient,
  checkSku,
  SafetyError,
  assertIngredientSafe,
  assertSkuSafe,
} from "./check.js";
