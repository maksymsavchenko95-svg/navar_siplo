import {
  type ConsolidatedIngredient,
  isPromoMatch,
  type MapperResult,
  type ProductMatch,
  promoTier,
  type RerankSkuMatchInput,
  type SkuMatch,
} from "@navar/domain";

import { consolidate } from "./consolidate.js";
import { decideMatch } from "./decide.js";
import { buildQuery, chunkQueries } from "./normalize-query.js";
import { computePack, parsePackSize } from "./pack.js";
import { rankCandidates, type ScoredCandidate } from "./score.js";
import {
  ACCEPT_GAP,
  type IngredientSafetyCheck,
  type MapperDictEntry,
  type MapperRetail,
  type PlanIngredientLine,
  type RerankFn,
  type SkuSafetyCheck,
} from "./types.js";

export interface MapPlanInput {
  /** Recipe lines for the whole plan, already scaled to the household's servings. */
  lines: readonly PlanIngredientLine[];
  dict: ReadonlyMap<string, MapperDictEntry>;
  /** Optional `receipt_lines` raw names — a light brand-affinity signal. */
  history?: readonly string[];
}

export interface MapPlanDeps {
  retail: MapperRetail;
  rerank: RerankFn;
  /** Ingredient-level safety gate (T2.2, `FR-SAFE-002` first pass). Absent = no household allergy. */
  ingredientSafety?: IngredientSafetyCheck;
  /** SKU-level safety gate (T2.2, `FR-SAFE-002` second pass). */
  skuSafety?: SkuSafetyCheck;
}

function toRerankInput(
  ingredient: {
    name: string;
    category: MapperDictEntry["category"];
    qty: number;
    unit: SkuMatch["neededUnit"];
  },
  top: readonly ScoredCandidate[],
): RerankSkuMatchInput {
  return {
    ingredient: {
      name: ingredient.name,
      category: ingredient.category,
      neededQty: Math.max(ingredient.qty, 1),
      unit: ingredient.unit,
    },
    candidates: top.slice(0, 5).map((sc) => ({
      name: sc.candidate.name,
      packSize: sc.candidate.packSize,
      price: sc.candidate.price,
      promo: isPromoMatch(sc.candidate),
      score: sc.score,
    })) as RerankSkuMatchInput["candidates"],
  };
}

const closeCall = (ranked: readonly ScoredCandidate[]): boolean =>
  ranked.length >= 2 && ranked[0]!.score - ranked[1]!.score <= ACCEPT_GAP;

function blockedMatch(c: ConsolidatedIngredient, query: string, reason: string): SkuMatch {
  return {
    slug: c.slug,
    ingredientNameUk: c.nameUk,
    query,
    neededAmount: c.amount,
    neededUnit: c.baseUnit,
    match: null,
    score: null,
    confidence: 0,
    decision: "blocked_unsafe",
    needsConfirmation: false,
    packCount: 0,
    packSize: null,
    surplusAmount: 0,
    isPromo: false,
    promoTier: null,
    candidatesConsidered: 0,
    rerankSource: null,
    safetyChecked: true,
    blockReason: reason,
    outOfStock: false,
  };
}

/**
 * Map a plan's ingredients to concrete Silpo SKUs (TDD §5, `FR-MAP-001..006`, `FR-SAFE-002`).
 * Consolidate → ingredient-level safety gate → normalise queries → batched search →
 * deterministic score → LLM re-rank only on a close call → SKU-level safety gate → flag
 * low-confidence, never add silently. Pack-size aware; out-of-stock picks (and their
 * replacements) go through the same funnel + the same safety check (`FR-SAFE-004`). The only
 * non-determinism is `deps.rerank`; with its offline fallback the pipeline is reproducible.
 */
export async function mapPlan(input: MapPlanInput, deps: MapPlanDeps): Promise<MapperResult> {
  const safetyOn = Boolean(deps.ingredientSafety);
  const consolidated = consolidate(input.lines, input.dict);

  // Ingredient-level gate first — blocked ingredients never reach search.
  const blockedBySlug = new Map<string, string>();
  const queryBySlug = new Map<string, string>();
  const uniqueQueries: string[] = [];
  for (const c of consolidated) {
    const entry = input.dict.get(c.slug)!;
    const block = deps.ingredientSafety?.(entry);
    if (block?.blocked) {
      blockedBySlug.set(c.slug, block.reason ?? "Не додано: не пройшло перевірку безпеки.");
      continue;
    }
    const query = buildQuery(entry);
    queryBySlug.set(c.slug, query);
    if (!uniqueQueries.includes(query)) uniqueQueries.push(query);
  }

  const resultsByQuery = new Map<string, ProductMatch[]>();
  const batches = await Promise.all(
    chunkQueries(uniqueQueries).map((chunk) => deps.retail.findProducts(chunk)),
  );
  for (const batch of batches) {
    for (const res of batch) resultsByQuery.set(res.query, res.products);
  }

  const matches: SkuMatch[] = [];
  for (const c of consolidated) {
    const blockReason = blockedBySlug.get(c.slug);
    if (blockReason) {
      matches.push(blockedMatch(c, buildQuery(input.dict.get(c.slug)!), blockReason));
      continue;
    }

    const entry = input.dict.get(c.slug)!;
    const query = queryBySlug.get(c.slug)!;
    const candidates = resultsByQuery.get(query) ?? [];

    let ranked = rankCandidates(entry, c.amount, candidates, input.history);
    let reranked: Awaited<ReturnType<RerankFn>> | undefined;
    if (closeCall(ranked)) {
      reranked = await deps.rerank(
        toRerankInput(
          { name: c.nameUk, category: c.category, qty: c.amount, unit: c.baseUnit },
          ranked,
        ),
      );
    }
    let d = decideMatch({ ranked, reranked });

    // Replacement funnel — only when the chosen SKU is out of stock (`FR-MAP-005`).
    if (d.chosen && !d.chosen.candidate.inStock && d.chosen.candidate.productId) {
      const { productId, companyId } = d.chosen.candidate;
      const [rep] = companyId ? await deps.retail.getReplacements([{ productId, companyId }]) : [];
      const repCandidates = rep?.replacements ?? [];
      if (repCandidates.length > 0) {
        const repRanked = rankCandidates(entry, c.amount, repCandidates, input.history);
        let repReranked: Awaited<ReturnType<RerankFn>> | undefined;
        if (closeCall(repRanked)) {
          repReranked = await deps.rerank(
            toRerankInput(
              { name: c.nameUk, category: c.category, qty: c.amount, unit: c.baseUnit },
              repRanked,
            ),
          );
        }
        const dRep = decideMatch({ ranked: repRanked, reranked: repReranked });
        if (dRep.chosen) {
          ranked = repRanked;
          // Keep the `replacement` label even when it needs confirmation — `needsConfirmation`
          // carries the "ask the Guest" signal, and collapsing to `needs_confirmation` would
          // hide that the pick is a substitution (`FR-MAP-005`).
          d = { ...dRep, decision: "replacement" };
        }
      }
    }

    // F5 / `FR-MAP-005`: the pick is still out of stock (no companyId, or the funnel found
    // nothing / an out-of-stock replacement). Never accept it silently — flag for the Guest.
    const chosenOutOfStock = Boolean(d.chosen && !d.chosen.candidate.inStock);
    if (chosenOutOfStock) {
      d = { ...d, decision: "needs_confirmation", needsConfirmation: true };
    }

    // SKU-level safety gate (`FR-SAFE-002` second pass, `FR-SAFE-004` for replacements).
    let skuBlockReason: string | null = null;
    if (d.chosen && deps.skuSafety) {
      const v = await deps.skuSafety({
        slug: c.slug,
        category: c.category,
        ingredientAllergens: entry.allergens,
        chosen: d.chosen.candidate,
      });
      if (v.blocked) skuBlockReason = v.reason ?? "Не додано: не пройшло перевірку безпеки.";
    }

    if (skuBlockReason) {
      matches.push(blockedMatch(c, query, skuBlockReason));
      continue;
    }

    const chosen = d.chosen?.candidate ?? null;
    const pack = computePack(c.amount, parsePackSize(chosen?.packSize ?? null, c.baseUnit), {
      weighted: chosen?.weighted,
      step: chosen?.step,
    });

    matches.push({
      slug: c.slug,
      ingredientNameUk: c.nameUk,
      query,
      neededAmount: c.amount,
      neededUnit: c.baseUnit,
      match: chosen,
      score: d.chosen?.score ?? null,
      confidence: d.confidence,
      decision: d.decision,
      needsConfirmation: d.needsConfirmation,
      packCount: chosen ? pack.packCount : 0,
      packSize: chosen ? pack.packSize : null,
      surplusAmount: chosen ? pack.surplusAmount : 0,
      isPromo: chosen ? isPromoMatch(chosen) : false,
      // The multi-buy tier travels to the solver so budget arithmetic can decide whether
      // the plan actually buys enough units to collect the discount (T4.1).
      promoTier: chosen ? promoTier(chosen) : null,
      candidatesConsidered: candidates.length,
      rerankSource: d.rerankSource,
      safetyChecked: safetyOn, // the ingredient-level gate ran for this line
      blockReason: null,
      outOfStock: chosenOutOfStock,
    });
  }

  const branchId = matches.find((m) => m.match?.branchId)?.match?.branchId ?? "";
  return {
    branchId,
    consolidated,
    matches,
    stats: {
      total: matches.length,
      matched: matches.filter((m) => m.match).length,
      needsConfirmation: matches.filter((m) => m.needsConfirmation).length,
      noMatch: matches.filter((m) => m.decision === "no_match").length,
      blocked: matches.filter((m) => m.decision === "blocked_unsafe").length,
    },
  };
}
