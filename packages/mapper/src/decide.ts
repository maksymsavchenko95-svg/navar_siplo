import type { SkuMatchDecision } from "@navar/domain";

import type { ScoredCandidate } from "./score.js";
import { ACCEPT_GAP, MIN_CONFIDENCE } from "./types.js";

export interface Decision {
  chosen: ScoredCandidate | null;
  decision: SkuMatchDecision;
  confidence: number;
  needsConfirmation: boolean;
  rerankSource: "llm" | "fallback" | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Turn the ranked candidates (and an optional LLM re-rank result) into the final pick
 * (TDD §5 step 4, `FR-MAP-006`). Pure — no I/O. `mapPlan` decides whether to re-rank by
 * checking the gap itself and only passes `reranked` in the close-call branch.
 *
 * A `needs_confirmation` match still carries its `chosen` SKU: it is recorded and flagged,
 * never dropped and never added silently (the cart write in T3.1 enforces the "silently").
 */
export function decideMatch(args: {
  ranked: readonly ScoredCandidate[];
  reranked?: { index: number; confidence: number; source: "llm" | "fallback" };
}): Decision {
  const { ranked, reranked } = args;

  if (ranked.length === 0) {
    // The search returned zero candidates. Per MCP `1.109.8` a zero-stock SKU can be
    // omitted from results even when searched by exact article code — so this is
    // "couldn't find it here", not a definitive "no such product" (`no_match`).
    return {
      chosen: null,
      decision: "sku_unknown",
      confidence: 0,
      needsConfirmation: true,
      rerankSource: null,
    };
  }

  let chosen: ScoredCandidate;
  let decision: SkuMatchDecision;
  let confidence: number;
  let rerankSource: "llm" | "fallback" | null = null;

  if (reranked) {
    chosen = ranked[reranked.index] ?? ranked[0]!;
    confidence = reranked.confidence;
    decision = "reranked";
    rerankSource = reranked.source;
  } else if (ranked.length === 1) {
    chosen = ranked[0]!;
    // F6: a lone candidate must still be able to fall below MIN_CONFIDENCE — no 0.6 floor.
    // A weak sole match (score ≈ 0.3 → ≈ 0.45) is flagged; a strong one (≈ 0.8 → ≈ 0.77)
    // is accepted. `FR-MAP-006` — never add a low-confidence match silently.
    confidence = clamp(0.25 + chosen.score * 0.65, 0, 0.9);
    decision = "accepted";
  } else {
    const gap = ranked[0]!.score - ranked[1]!.score;
    chosen = ranked[0]!;
    // TDD only defines confidence post-rerank; this is a documented heuristic for the
    // clear-winner path — the wider the gap, the more certain.
    confidence = clamp(0.6 + (gap - ACCEPT_GAP), 0.6, 0.95);
    decision = "accepted";
  }

  const needsConfirmation = confidence < MIN_CONFIDENCE;
  return {
    chosen,
    decision: needsConfirmation ? "needs_confirmation" : decision,
    confidence,
    needsConfirmation,
    rerankSource,
  };
}
