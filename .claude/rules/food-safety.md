# Rule: Food-safety guardrails

Spec: `docs/srs.md` §6.8 (`FR-SAFE-*`), §8.5 (`NFR-DATA-004`). A missed allergen is a
**catastrophic** failure with asymmetric consequences. Target: zero missed allergens.

## Non-negotiables

1. **Deterministic code, not a prompt, performs every restriction/allergen check**
   (`FR-SAFE-001`, `ARCH-01`). Never rely on "the model remembers the restriction".
2. **Check twice:** once at `CanonicalIngredient` level during planning, again at the
   concrete SKU level via `silpo_get_product_details` before adding to the cart
   (`FR-SAFE-002`).
3. **Fail closed.** If a SKU's composition is unavailable or ambiguous and the household
   declared an allergy, the item is **not added** and the guest is told explicitly. Never
   fail open (`FR-SAFE-003`).
4. **Replacements get the same checks** as primary items — `silpo_get_replacements` /
   `silpo_get_similar_products` output is not trusted (`FR-SAFE-004`).
5. Recipe allergens are the **union of ingredient allergens**, computed, never hand-set
   (`FR-RECIPE-003`).
6. Every guardrail trigger is logged with full context for review (`FR-SAFE-006`).

## Calorie floor — `form` mode (`FR-SAFE-009`)

A `form` household's `kcal_target` can **never** sit below `KCAL_FLOOR` (1200). Enforced
fail-closed in **three** places, all of which must stay in sync:

1. `assertKcalFloor` in `@navar/domain` (re-exported by `@navar/safety`);
2. the `kcalTarget` refine in `nutritionTargetsSchema` (`@navar/domain`);
3. the `CHECK (kcal_target >= 1200)` on `nutrition_targets` (`packages/db/src/schema.ts`).

A sub-floor request is **rejected with an explanation**, never silently clamped. Targets
are computed by the system from body metrics (`FR-GOAL-003`), never entered directly.

## Nutrition figures are estimates (`RISK-10`, `Q-09`)

- Recipe macros are the **sum of ingredient macros × grams ÷ servings**, computed on
  import — never hand-set (same rule as the allergen union).
- Weighed produce / meat / grains take macros from the `canonical_ingredients` reference
  table (`nutrition_src = 'reference' | 'estimated'`), not the SKU card.
- When `nutrition_src = 'estimated'` covers >30 % of a plan's ingredient mass, the plan is
  **marked an estimate** and exact macro numbers are withheld.

## Scope limits (`CON-04`, `FR-SAFE-008`)

- Navar is not a medical device. No therapeutic/medical diets, no medical terminology in
  recommendations. `form` mode is framed as a **goal / preference**, not a treatment.
- Every plan carries the disclaimer: not a medical service; for critical allergies the
  guest must check the packaging themselves (`FR-SAFE-005`).

## Hard vs soft constraints in the planner

- **Hard** (violation → no plan is issued): food restrictions & allergies; budget ceiling;
  SKU availability; and — `form` mode only — the daily protein floor and the calorie
  corridor (`FR-PLAN-002`, TDD v0.2 §4).
- **Soft** (maximized, in weight order — profile per goal, `WEIGHTS[goal]`): promo coverage;
  pantry use; 4-week variety; brand preference; prep-time limit; ingredient reuse across ≥2
  dishes; and — `form` — protein-per-₴ and vegetable share (`FR-PLAN-003`).
- The mode enters the solver only through `SolverInput` (constraints + weights) — never a
  code branch, never a `fitness` recipe tag (ADR-09).
