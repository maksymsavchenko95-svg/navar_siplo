import { describe, expect, it } from "vitest";

import { rerankSkuMatchInputSchema, rerankSkuMatchOutputSchema, skuMatchSchema } from "./mapper.js";

const CANDIDATE = { name: "Молоко 2.5%", packSize: "900мл", price: 42, promo: false, score: 0.8 };

describe("rerankSkuMatchOutputSchema", () => {
  it("rejects an out-of-range index", () => {
    expect(() => rerankSkuMatchOutputSchema.parse({ index: 5, confidence: 0.5 })).toThrow();
    expect(() => rerankSkuMatchOutputSchema.parse({ index: -1, confidence: 0.5 })).toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() => rerankSkuMatchOutputSchema.parse({ index: 0, confidence: 1.4 })).toThrow();
  });

  it("accepts a valid pick", () => {
    expect(rerankSkuMatchOutputSchema.parse({ index: 2, confidence: 0.82 })).toEqual({
      index: 2,
      confidence: 0.82,
    });
  });
});

describe("rerankSkuMatchInputSchema", () => {
  const ingredient = {
    name: "Молоко",
    category: "dairy_eggs" as const,
    neededQty: 500,
    unit: "ml" as const,
  };

  it("requires 2..5 candidates", () => {
    expect(() =>
      rerankSkuMatchInputSchema.parse({ ingredient, candidates: [CANDIDATE] }),
    ).toThrow();
    expect(() =>
      rerankSkuMatchInputSchema.parse({ ingredient, candidates: Array(6).fill(CANDIDATE) }),
    ).toThrow();
    expect(
      rerankSkuMatchInputSchema.parse({ ingredient, candidates: [CANDIDATE, CANDIDATE] })
        .candidates,
    ).toHaveLength(2);
  });
});

describe("skuMatchSchema", () => {
  const base = {
    slug: "milk",
    ingredientNameUk: "Молоко",
    query: "молоко",
    neededAmount: 500,
    neededUnit: "ml" as const,
    match: null,
    score: null,
    confidence: 0,
    decision: "no_match" as const,
    needsConfirmation: true,
    packCount: 0,
    packSize: null,
    surplusAmount: 0,
    isPromo: false,
    candidatesConsidered: 0,
    rerankSource: null,
    safetyChecked: false,
    blockReason: null,
  };

  it("round-trips a hand-built match", () => {
    expect(skuMatchSchema.parse(base)).toEqual(base);
  });

  it("round-trips a safety-blocked match", () => {
    const blocked = {
      ...base,
      decision: "blocked_unsafe" as const,
      needsConfirmation: false,
      safetyChecked: true,
      blockReason: "Не додано: містить алерген (глютен).",
    };
    expect(skuMatchSchema.parse(blocked)).toEqual(blocked);
  });
});
