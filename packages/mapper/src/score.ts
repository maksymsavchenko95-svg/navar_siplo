import {
  type IngredientCategory,
  isPromoMatch,
  normalizeText,
  type ProductMatch,
  trigramSimilarity,
} from "@navar/domain";

import { parsePackSize } from "./pack.js";
import { type MapperDictEntry, OVERSIZE_PACK_RATIO } from "./types.js";

/**
 * Deterministic candidate score (TDD §5 step 3, ADR-02). Weights are tunable constants;
 * the golden dataset (`golden.test.ts`) is the signal for whether a change helps. There is
 * **no category term** from search — `find_products_batch` returns no category; the
 * dictionary category drives `form` and category-aware `packFit` (R7).
 */
const WEIGHTS = {
  nameSim: 0.55,
  packFit: 0.2,
  // T4.1: doubled from 0.1 so promo actually steers SKU choice (AC-P0-04) — and it now
  // fires on multi-buy tiers too, not just `oldPrice` markdowns.
  //
  // Invariant: the positive weights (nameSim + packFit + promo + brand) sum to exactly 1.0,
  // so `clamp01` never truncates a real difference. `priceOutlier` and `form` are the two
  // negative-only terms (R7). Raising `promo` further would saturate high-scoring candidates
  // at 1.0 and *compress* the promo advantage. 0.2 sits just under `ACCEPT_GAP` (0.25), so
  // promo alone still leaves a pair a "close call" — deliberate: the LLM re-rank sees the
  // promo flag and decides, rather than promo silently overriding a better name match.
  promo: 0.2,
  brand: 0.05,
  // negative-only
  priceOutlier: 0.15, // R7: was 0.1 — now compares ₴ per base unit, not absolute price
  form: 0.4, // R7: wrong preparation for the dictionary category (pickled veg, canned meat…)
} as const;

/**
 * Per dictionary category, SKU-name stems that mean the wrong preparation for a recipe that
 * asked for the fresh / raw ingredient (R7). Conservative — a frozen or fermented substitute
 * is a judgement call left to the Guest, an outright pickled / canned / confectionery form
 * is not. Matched as a substring of `normalizeText(name)`.
 */
const WRONG_FORM: Partial<Record<IngredientCategory, readonly string[]>> = {
  vegetable: [
    "маринован",
    "консерв",
    "квашен",
    "по корейськ", // normalizeText drops the hyphen in «по-корейськи»
    "салат",
    "заправка",
    "приправа",
    "джем",
    "варенн",
    "цукат",
    "повидл",
    "компот",
    "ікра",
  ],
  fruit: ["маринован", "консерв", "сушен", "цукат", "джем", "варенн", "повидл", "компот", "сік"],
  meat: [
    "тушкован",
    "консерв",
    "вялен", // «в'ялена» → normalizeText → «вялена» (jerky)
    "сосиск",
    "сардельк",
    "ковбас",
    "паштет",
    "шинка",
    "снек",
    "джерк",
    "jerky",
    "напівфабрикат",
    "пельмен",
    "вареник",
    "котлет",
    "біфштекс", // a formed patty
    "купат",
    "люля",
    "фрикадельк",
    "наггетс",
    "бекон",
  ],
  fish: ["консерв", "пресерв", "копчен", "ікра", "крабов", "сурімі"],
  dairy_eggs: ["згущен", "сухе молоко", "сух вершк"],
};

/** Shelf-stable categories where an oversized pack is a convenience, not a penalty (R7). */
const OVERSIZE_OK: ReadonlySet<IngredientCategory> = new Set([
  "pantry",
  "spice_herb",
  "fat_oil",
  "grain",
]);

export interface ScoredCandidate {
  candidate: ProductMatch;
  score: number; // 0..1
  breakdown: {
    nameSim: number;
    packFit: number;
    promo: number;
    priceOutlier: number;
    brand: number;
    form: number;
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
  const decay =
    ratio >= OVERSIZE_PACK_RATIO ? 0.1 : 1 - ((ratio - 1.5) / (OVERSIZE_PACK_RATIO - 1.5)) * 0.7; // 1 at 1.5 → 0.3 at 3
  // R7: for salt / spices / oil / grain an oversized pack is a stocked staple, not waste.
  return OVERSIZE_OK.has(entry.category) ? Math.max(0.7, decay) : decay;
}

/** ₴ per base unit (g / ml). Weighed goods: `price` is ₴/kg (MCP 1.109.8). `null` when unknown. */
function pricePerBase(entry: MapperDictEntry, c: ProductMatch): number | null {
  if (c.price <= 0) return null;
  if (c.weighted) return entry.baseUnit === "g" ? c.price / 1000 : null;
  const pack = parsePackSize(c.packSize, entry.baseUnit);
  return pack && pack > 0 ? c.price / pack : null;
}

const MIN_PRICES = 3;

/**
 * −1 for a candidate that is BOTH absolutely much dearer than the cheapest option (a
 * premium SKU) AND dearer per base unit (so it isn't just a legitimate bulk pack). Compared
 * against the *minimum* peer, not the median — a result set that is mostly premium (the R7
 * salt case) then still flags the truly absurd one; a bigger-pack / same-₴-per-kg SKU never
 * flags. Needs ≥3 priced candidates so a thin, noisy set doesn't self-penalise.
 */
function priceOutlier(
  entry: MapperDictEntry,
  candidate: ProductMatch,
  peers: readonly ProductMatch[],
): number {
  if (candidate.price <= 0) return 0;
  const priced = peers.filter((p) => p.price > 0);
  if (priced.length < MIN_PRICES) return 0;
  const minAbs = Math.min(...priced.map((p) => p.price));

  const mineRate = pricePerBase(entry, candidate);
  const peerRates = priced
    .map((p) => pricePerBase(entry, p))
    .filter((v): v is number => v != null && v > 0);
  const minRate = peerRates.length ? Math.min(...peerRates) : null;

  const dearAbsolute = candidate.price > 2 * minAbs;
  const dearPerUnit = mineRate == null || minRate == null || mineRate > 1.3 * minRate;
  return dearAbsolute && dearPerUnit ? -1 : 0;
}

/**
 * True when a SKU name carries a wrong-preparation stem for the ingredient's category
 * (R7 — pickled veg, canned/jerky meat…). Pure; exported for the cart-preview "no fresh
 * meat" hint and the meal-swap detection.
 */
export function isWrongForm(category: IngredientCategory, name: string): boolean {
  const stems = WRONG_FORM[category];
  if (!stems) return false;
  const n = normalizeText(name);
  return stems.some((s) => n.includes(s));
}

/** 1 when the SKU name carries a wrong-preparation stem for the ingredient's category (R7). */
function formHit(entry: MapperDictEntry, name: string): number {
  return isWrongForm(entry.category, name) ? 1 : 0;
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
  const promo = isPromoMatch(candidate) ? 1 : 0; // shelf markdown OR a multi-buy tier (T4.1)
  const outlier = priceOutlier(entry, candidate, peers); // R7: ₴ per base unit
  const form = formHit(entry, candidate.name); // R7: wrong preparation for the category
  const brand = brandAffinity(history, candidate.name);

  const score = clamp01(
    WEIGHTS.nameSim * nameSim +
      WEIGHTS.packFit * fit +
      WEIGHTS.promo * promo +
      WEIGHTS.brand * brand +
      WEIGHTS.priceOutlier * outlier +
      WEIGHTS.form * -form,
  );

  return {
    candidate,
    score,
    breakdown: { nameSim, packFit: fit, promo, priceOutlier: outlier, brand, form },
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
