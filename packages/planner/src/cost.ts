import { effectiveUnitPrice, type IngredientCategory, tierApplies } from "@navar/domain";

import type { RecipeCandidate, SolverInput } from "./contract.js";

/** Guard against float dust so determinism tests deep-equal cleanly (mapper's idiom). */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface RecipeCost {
  costUah: number;
  promoShareUah: number;
  /** ingredientId → base-unit amount left in the pantry **after** cooking this recipe. */
  pantryAfter: Map<string, number>;
  unmappedIds: string[]; // non-optional lines with no price entry
  /** Non-optional lines priced by a category-median estimate rather than a real SKU (F3). */
  estimatedIds: string[];
  /** The portion of `costUah` that came from those estimates. */
  estimatedCostUah: number;
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Median SKU price per ingredient category across the whole `SolverInput` basket, plus a
 * global median fallback. Used to price a recipe line that the mapper could not resolve
 * (F3) so it is not treated as free — the hard filter already vetted that ≤ 20 % of a
 * recipe's lines are unmapped. Deterministic (order-independent). Returns `null` when the
 * basket carries no prices at all — nothing to estimate from.
 */
export function categoryMedianPrices(
  input: SolverInput,
): { byCategory: Map<IngredientCategory, number>; global: number } | null {
  if (input.prices.size === 0) return null;
  const catById = new Map<string, IngredientCategory>();
  for (const c of input.candidates) {
    for (const l of c.ingredients) if (!catById.has(l.id)) catById.set(l.id, l.category);
  }
  const byCat = new Map<IngredientCategory, number[]>();
  const all: number[] = [];
  for (const [id, price] of input.prices) {
    all.push(price.uah);
    const cat = catById.get(id);
    if (cat == null) continue;
    const bucket = byCat.get(cat);
    if (bucket) bucket.push(price.uah);
    else byCat.set(cat, [price.uah]);
  }
  const byCategory = new Map<IngredientCategory, number>();
  for (const [cat, xs] of byCat) byCategory.set(cat, median(xs));
  return { byCategory, global: median(all) };
}

/**
 * `COST(recipe)` (TDD §4 step 2) — computed in **pack sizes, not grams**. A recipe needing
 * 5 g of dill costs a whole bunch. Scales every ingredient by `servings / recipe.servings`
 * and, on top, by `portionScale` (T3.3 — buying more/less of everything for a bigger/
 * smaller portion); whatever the running `pantry` (surplus from earlier picks) covers is
 * not re-bought, and the new surplus is returned so the greedy can carry it forward — this
 * is the economic side of "reuse an ingredient across ≥2 dishes" (`FR-PLAN-003`). A
 * non-optional line with no `prices` entry is priced at the category-median SKU price
 * (F3) — the &gt;20% unmapped rule already vetted the recipe — and only contributes 0 when
 * the basket has no prices.
 */
export function recipeCost(
  candidate: RecipeCandidate,
  input: SolverInput,
  portionScale = 1,
): RecipeCost {
  const scale = (candidate.servings > 0 ? input.servings / candidate.servings : 1) * portionScale;
  const medians = categoryMedianPrices(input);
  let costUah = 0;
  let promoShareUah = 0;
  let estimatedCostUah = 0;
  const pantryAfter = new Map<string, number>();
  const unmappedIds: string[] = [];
  const estimatedIds: string[] = [];

  for (const line of candidate.ingredients) {
    if (line.optional) continue;
    const price = input.prices.get(line.id);
    if (!price) {
      unmappedIds.push(line.id);
      // F3: don't treat an unmapped non-optional line as free. Estimate one "pack" at the
      // category-median SKU price (global median as fallback); 0 only when the basket has
      // no prices to learn from. The estimate feeds `costUah` so the greedy's budget
      // feasibility and totals stop being optimistic.
      if (medians) {
        const est = round2(medians.byCategory.get(line.category) ?? medians.global);
        costUah += est;
        estimatedCostUah += est;
        estimatedIds.push(line.id);
      }
      continue;
    }
    const needed = line.amount * scale;
    const have = input.pantry.get(line.id) ?? 0;
    const toBuy = Math.max(0, needed - have);
    const packs = price.packSize > 0 ? Math.ceil(toBuy / price.packSize) : 0;
    // A multi-buy tier only pays out once the plan actually buys `minCount` units, so the
    // unit price — and whether this line counts as promo at all — depends on `packs`.
    // Counting an unreached tier as promo would overstate the Guest-facing share (T4.1).
    //
    // Known approximation: packs are counted per recipe, while the shopping list
    // consolidates across recipes, so an ingredient buying one pack in each of three
    // dishes won't trigger a `minCount: 2` tier the real cart would reach. That
    // under-counts promo, which is the safe direction — it never overstates savings.
    const tierHit = tierApplies(price.tier, packs);
    const lineCost = packs * effectiveUnitPrice(price.uah, price.tier, packs);
    costUah += lineCost;
    if (price.promo || tierHit) promoShareUah += lineCost;
    pantryAfter.set(line.id, Math.max(0, round6(have + packs * price.packSize - needed)));
  }

  return {
    costUah: round2(costUah),
    promoShareUah: round2(promoShareUah),
    pantryAfter,
    unmappedIds,
    estimatedIds,
    estimatedCostUah: round2(estimatedCostUah),
  };
}
