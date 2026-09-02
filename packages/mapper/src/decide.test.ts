import type { ProductMatch } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { decideMatch } from "./decide.js";
import type { ScoredCandidate } from "./score.js";

const cand = (productId: string): ProductMatch => ({
  productId,
  externalProductId: null,
  companyId: "co",
  branchId: "br",
  slug: productId,
  name: productId,
  price: 40,
  oldPrice: null,
  packSize: "500г",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
});

const scored = (productId: string, score: number): ScoredCandidate => ({
  candidate: cand(productId),
  score,
  breakdown: { nameSim: score, packFit: 1, promo: 0, priceOutlier: 0, brand: 0 },
});

describe("decideMatch", () => {
  it("no candidates → no_match, flagged", () => {
    const d = decideMatch({ ranked: [] });
    expect(d).toMatchObject({
      chosen: null,
      decision: "no_match",
      needsConfirmation: true,
      confidence: 0,
    });
  });

  it("clear winner (gap > 0.25) → accepted without a rerank", () => {
    const d = decideMatch({ ranked: [scored("a", 0.9), scored("b", 0.5)] });
    expect(d.decision).toBe("accepted");
    expect(d.chosen!.candidate.productId).toBe("a");
    expect(d.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("close call → uses the rerank result", () => {
    const d = decideMatch({
      ranked: [scored("a", 0.7), scored("b", 0.62)],
      reranked: { index: 1, confidence: 0.8, source: "llm" },
    });
    expect(d.decision).toBe("reranked");
    expect(d.chosen!.candidate.productId).toBe("b");
    expect(d.rerankSource).toBe("llm");
  });

  it("low rerank confidence → needs_confirmation, but the SKU is still recorded", () => {
    const d = decideMatch({
      ranked: [scored("a", 0.7), scored("b", 0.62)],
      reranked: { index: 0, confidence: 0.4, source: "fallback" },
    });
    expect(d.decision).toBe("needs_confirmation");
    expect(d.needsConfirmation).toBe(true);
    expect(d.chosen!.candidate.productId).toBe("a");
  });

  it("single strong candidate → accepted with a score-derived confidence", () => {
    const d = decideMatch({ ranked: [scored("only", 0.8)] });
    expect(d.decision).toBe("accepted");
    expect(d.chosen!.candidate.productId).toBe("only");
    expect(d.needsConfirmation).toBe(false);
  });

  it("single weak candidate → flagged, not silently accepted (F6)", () => {
    const d = decideMatch({ ranked: [scored("weak", 0.3)] });
    expect(d.confidence).toBeLessThan(0.6);
    expect(d.decision).toBe("needs_confirmation");
    expect(d.needsConfirmation).toBe(true);
    expect(d.chosen!.candidate.productId).toBe("weak"); // still recorded
  });
});
