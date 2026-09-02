import { normalizeText, type ProductMatch, trigramSimilarity } from "@navar/domain";

import { parsePackSize } from "./pack.js";
import { type MapperDictEntry, OVERSIZE_PACK_RATIO } from "./types.js";

/**
 * Deterministic candidate score (TDD §5 step 3, ADR-02). Weights are tunable constants;
 * the golden dataset (`golden.test.ts`) is the signal for whether a change helps. There is
 * **no category term** — `find_products_batch` returns no category (documented in the plan).
 */
const WEIGHTS = {
  nameSim: 0.55,
  packFit: 0.2,
  promo: 0.1,
  priceOutlier: 0.1,
  brand: 0.05,
} as const;

export interface ScoredCandidate {
  candidate: ProductMatch;
  score: number; // 0..1
  breakdown: {
    nameSim: number;
    packFit: number;
    promo: number;
    priceOutlier: number;
    brand: number;
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function median(values: readonly number[]): number {
  const xs = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/** Best trigram similarity of the SKU name against the ingredient's name + every synonym. */
function nameSimilarity(entry: MapperDictEntry, name: string): number {
  const skuName = normalizeText(name);
  let best = 0;
  for (const ref of [entry.nameUk, ...entry.synonyms]) {
    best = Math.max(best, trigramSimilarity(skuName, normalizeText(ref)));
  }
  return best;
}

/** `1` for a well-sized pack, decaying to `~0.1` for a grossly oversized one. Weighed goods fit exactly. */
function packFit(entry: MapperDictEntry, neededBase: number, candidate: ProductMatch): number {
  if (candidate.weighted) return 1;
  const pack = parsePackSize(candidate.packSize, entry.baseUnit);
  if (pack == null || neededBase <= 0) return 0.5; // unknown → neutral
  const ratio = pack / neededBase;
  if (ratio <= 1.5) return 1;
  if (ratio >= OVERSIZE_PACK_RATIO) return 0.1;
  // linear from 1 at ratio 1.5 to 0.3 at ratio 3
  return 1 - ((ratio - 1.5) / (OVERSIZE_PACK_RATIO - 1.5)) * 0.7;
}

function brandAffinity(history: readonly string[] | undefined, name: string): number {
  if (!history || history.length === 0) return 0;
  const skuTokens = new Set(
    normalizeText(name)
      .split(" ")
      .filter((t) => t.length >= 4),
  );
  for (const h of history) {
    for (const t of normalizeText(h).split(" ")) {
      if (t.length >= 4 && skuTokens.has(t)) return 1;
    }
  }
  return 0;
}

export function scoreCandidate(args: {
  entry: MapperDictEntry;
  neededBase: number;
  candidate: ProductMatch;
  peers: readonly ProductMatch[];
  history?: readonly string[];
}): ScoredCandidate {
  const { entry, neededBase, candidate, peers, history } = args;

  const nameSim = nameSimilarity(entry, candidate.name);
  const fit = packFit(entry, neededBase, candidate);
  const promo = candidate.oldPrice != null && candidate.oldPrice > candidate.price ? 1 : 0;

  const med = median(peers.map((p) => p.price));
  const priceOutlier =
    med > 0 && (candidate.price > 2 * med || candidate.price < 0.3 * med) ? -1 : 0;

  const brand = brandAffinity(history, candidate.name);

  const score = clamp01(
    WEIGHTS.nameSim * nameSim +
      WEIGHTS.packFit * fit +
      WEIGHTS.promo * promo +
      WEIGHTS.priceOutlier * priceOutlier +
      WEIGHTS.brand * brand,
  );

  return {
    candidate,
    score,
    breakdown: { nameSim, packFit: fit, promo, priceOutlier, brand },
  };
}

/**
 * Score every candidate and return them best-first. Stable tiebreak on `(score, productId)`
 * so the order is deterministic regardless of input order (ADR-03).
 */
export function rankCandidates(
  entry: MapperDictEntry,
  neededBase: number,
  candidates: readonly ProductMatch[],
  history?: readonly string[],
): ScoredCandidate[] {
  return candidates
    .map((candidate) =>
      scoreCandidate({ entry, neededBase, candidate, peers: candidates, history }),
    )
    .sort(
      (a, b) => b.score - a.score || a.candidate.productId.localeCompare(b.candidate.productId),
    );
}
