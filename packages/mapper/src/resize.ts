import type { MapperResult, SkuMatch } from "@navar/domain";

import { computePack, parsePackSize } from "./pack.js";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Re-size a corpus-wide `MapperResult` down to what one concrete set of chosen recipes
 * actually needs (R0). The mapper prices the *whole* usable corpus at each recipe's own
 * yield so the solver can compare every candidate; the persisted shopping list must instead
 * reflect the 5 picked dinners × the household's servings × each day's portion scale.
 *
 * `neededBySlug` is the consolidated base-unit demand of the picked dinners — the caller
 * (`apps/api`) computes it from the solver's `RecipeCandidate` lines, already scaled by
 * `servings / recipe.servings × portionScale` (mirrors `recipeCost` in `@navar/planner`).
 *
 * Each surviving match keeps its chosen SKU, decision, confidence, promo flags and safety
 * verdict — only the quantity fields (`neededAmount`, `packCount`, `packSize`, `quantityKg`,
 * `surplusAmount`) are recomputed via `computePack`. Matches for ingredients that no chosen
 * recipe uses are dropped.
 */
export function resizeMatches(
  matches: readonly SkuMatch[],
  neededBySlug: ReadonlyMap<string, number>,
): SkuMatch[] {
  const out: SkuMatch[] = [];
  for (const m of matches) {
    const needed = neededBySlug.get(m.slug);
    if (needed == null) continue; // an ingredient no picked recipe cooks with

    const pack = m.match
      ? computePack(needed, parsePackSize(m.match.packSize, m.neededUnit), {
          weighted: m.match.weighted,
          step: m.match.step,
        })
      : null;

    out.push({
      ...m,
      neededAmount: round2(needed),
      packCount: pack?.packCount ?? 0,
      packSize: pack?.packSize ?? null,
      quantityKg: pack?.quantityKg ?? null,
      surplusAmount: pack?.surplusAmount ?? 0,
    });
  }
  return out;
}

/** Recompute `MapperResult.stats` from a (re-sized) match list. */
export function statsFor(matches: readonly SkuMatch[]): MapperResult["stats"] {
  return {
    total: matches.length,
    matched: matches.filter((m) => m.match != null).length,
    needsConfirmation: matches.filter((m) => m.needsConfirmation).length,
    noMatch: matches.filter((m) => m.match == null && m.decision !== "blocked_unsafe").length,
    blocked: matches.filter((m) => m.decision === "blocked_unsafe").length,
  };
}
