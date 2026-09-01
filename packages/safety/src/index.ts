/**
 * @navar/safety — food-safety guardrails. Deterministic, fail-closed (ADR-05). Nothing
 * enters a plan or the cart without a code check against the household's restrictions,
 * run twice: at the CanonicalIngredient level during planning, and at the concrete SKU
 * level via `silpo_get_product_details` before add-to-cart. Unknown / ambiguous
 * composition + a declared allergy → block. Replacements get the same checks.
 *
 * Spec: SRS §6.8 (`FR-SAFE-*`), TDD §5 step 5. Kept a separate package on purpose. Never
 * a prompt.
 *
 * ── Goal-mode guardrails (TDD v0.2) ───────────────────────────────────────────
 * - `FR-SAFE-009` (calorie floor): a `form` household's `kcal_target` can never sit
 *   below `KCAL_FLOOR`. Enforced fail-closed in three places — `assertKcalFloor` in
 *   `@navar/domain`, the `nutritionTargetsSchema` refine, and the `nutrition_targets`
 *   DB CHECK. A sub-floor request is rejected with an explanation, never clamped.
 * - `RISK-10` (estimate honesty): when `nutrition_src='estimated'` for >30 % of a
 *   plan's ingredient mass, the plan is marked an estimate and exact macro figures are
 *   withheld.
 * - `form` is framed as a preference / goal, never a treatment — no medical diets or
 *   medical terminology (`CON-04`, `FR-SAFE-008`).
 */

export { assertKcalFloor, KcalFloorError } from "@navar/domain";

export function assertIngredientSafe(): never {
  throw new Error("safety not implemented — P0 (SRS §6.8)");
}

export function assertSkuSafe(): never {
  throw new Error("safety not implemented — P0 (SRS §6.8)");
}
