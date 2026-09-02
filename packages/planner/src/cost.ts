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
}

/**
 * `COST(recipe)` (TDD §4 step 2) — computed in **pack sizes, not grams**. A recipe needing
 * 5 g of dill costs a whole bunch. Scales every ingredient by `servings / recipe.servings`;
 * whatever the running `pantry` (surplus from earlier picks) covers is not re-bought, and
 * the new surplus is returned so the greedy can carry it forward — this is the economic
 * side of "reuse an ingredient across ≥2 dishes" (`FR-PLAN-003`). A non-optional line with
 * no `prices` entry contributes 0 cost (the &gt;20% unmapped rule already vetted the recipe).
 */
export function recipeCost(candidate: RecipeCandidate, input: SolverInput): RecipeCost {
  const scale = candidate.servings > 0 ? input.servings / candidate.servings : 1;
  let costUah = 0;
  let promoShareUah = 0;
  const pantryAfter = new Map<string, number>();
  const unmappedIds: string[] = [];

  for (const line of candidate.ingredients) {
    if (line.optional) continue;
    const price = input.prices.get(line.id);
    if (!price) {
      unmappedIds.push(line.id);
      continue;
    }
    const needed = line.amount * scale;
    const have = input.pantry.get(line.id) ?? 0;
    const toBuy = Math.max(0, needed - have);
    const packs = price.packSize > 0 ? Math.ceil(toBuy / price.packSize) : 0;
    const lineCost = packs * price.uah;
    costUah += lineCost;
    if (price.promo) promoShareUah += lineCost;
    pantryAfter.set(line.id, Math.max(0, round6(have + packs * price.packSize - needed)));
  }

  return {
    costUah: round2(costUah),
    promoShareUah: round2(promoShareUah),
    pantryAfter,
    unmappedIds,
  };
}
