import type { MapperResult, ProductMatch, RerankSkuMatchInput, SkuMatch } from "@navar/domain";

import { consolidate } from "./consolidate.js";
import { decideMatch } from "./decide.js";
import { buildQuery, chunkQueries } from "./normalize-query.js";
import { computePack, parsePackSize } from "./pack.js";
import { rankCandidates, type ScoredCandidate } from "./score.js";
import {
  ACCEPT_GAP,
  type MapperDictEntry,
  type MapperRetail,
  type PlanIngredientLine,
  type RerankFn,
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
}

const isPromo = (p: ProductMatch): boolean => p.oldPrice != null && p.oldPrice > p.price;

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
      promo: isPromo(sc.candidate),
      score: sc.score,
    })) as RerankSkuMatchInput["candidates"],
  };
}

const closeCall = (ranked: readonly ScoredCandidate[]): boolean =>
  ranked.length >= 2 && ranked[0]!.score - ranked[1]!.score <= ACCEPT_GAP;

/**
 * Map a plan's ingredients to concrete Silpo SKUs (TDD §5, `FR-MAP-001..006`). Consolidate
 * → normalise queries → batched search → deterministic score → LLM re-rank only on a close
 * call → flag low-confidence, never add silently. Pack-size aware; out-of-stock picks go
 * through the replacement funnel. The only non-determinism is `deps.rerank`; with its
 * offline fallback the whole pipeline is reproducible (ADR-03).
 */
export async function mapPlan(input: MapPlanInput, deps: MapPlanDeps): Promise<MapperResult> {
  const consolidated = consolidate(input.lines, input.dict);

  // 1 query per ingredient, deduped in first-seen order.
  const queryBySlug = new Map<string, string>();
  const uniqueQueries: string[] = [];
  for (const c of consolidated) {
    const query = buildQuery(input.dict.get(c.slug)!);
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
          d = {
            ...dRep,
            decision: dRep.needsConfirmation ? "needs_confirmation" : "replacement",
          };
        }
      }
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
      isPromo: chosen ? isPromo(chosen) : false,
      candidatesConsidered: candidates.length,
      rerankSource: d.rerankSource,
      safetyChecked: false,
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
    },
  };
}
