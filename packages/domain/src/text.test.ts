import { describe, expect, it } from "vitest";

import { normalizeText, trigramSimilarity, trigrams } from "./text.js";

describe("normalizeText", () => {
  it("lowercases, strips digits / % / punctuation, collapses whitespace", () => {
    expect(normalizeText("Сметана 20%")).toBe("сметана");
    expect(normalizeText("  Молоко,  2.5%  ")).toBe("молоко");
    expect(normalizeText("Олія «Щедрий Дар»")).toBe("олія щедрий дар");
  });

  it("drops apostrophe variants and folds ё→е", () => {
    expect(normalizeText("Пюре'шка")).toBe("пюрешка");
    expect(normalizeText("гречка ёдристая")).toBe("гречка едристая");
  });
});

describe("trigrams", () => {
  it("is empty for a letterless string", () => {
    expect(trigrams("123 %%%").size).toBe(0);
    expect(trigrams("").size).toBe(0);
  });

  it("pads each word and windows it", () => {
    // "  ab " → "  a", " ab", "ab ", plus nothing else
    expect([...trigrams("ab")].sort()).toEqual(["  a", " ab", "ab "].sort());
  });
});

describe("trigramSimilarity", () => {
  it("is 1 for identical strings and for two empty strings", () => {
    expect(trigramSimilarity("куряче філе", "куряче філе")).toBe(1);
    expect(trigramSimilarity("", "")).toBe(1);
  });

  it("is 0 when one side is empty or the sets are disjoint", () => {
    expect(trigramSimilarity("молоко", "")).toBe(0);
    expect(trigramSimilarity("молоко", "yzx")).toBe(0);
  });

  it("scores word-order variants in a sensible band", () => {
    const s = trigramSimilarity("куряче філе", "філе куряче охолоджене");
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.9);
  });

  it("is symmetric", () => {
    const a = trigramSimilarity("сметана", "сметана домашня");
    const b = trigramSimilarity("сметана домашня", "сметана");
    expect(a).toBe(b);
  });

  it("is deterministic", () => {
    const once = trigramSimilarity("томатна паста", "паста томатна");
    const twice = trigramSimilarity("томатна паста", "паста томатна");
    expect(once).toBe(twice);
  });
});
