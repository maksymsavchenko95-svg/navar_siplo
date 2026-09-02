import { describe, expect, it } from "vitest";

import { buildQuery, chunkQueries } from "./normalize-query.js";
import type { MapperDictEntry } from "./types.js";

const entry = (nameUk: string, synonyms: string[] = []): MapperDictEntry => ({
  slug: "x",
  nameUk,
  category: "other",
  baseUnit: "g",
  densityGMl: null,
  gramsPerPiece: null,
  synonyms,
  allergens: [],
});

describe("buildQuery — M0 audit failure cases", () => {
  it("drops the packaging word 'пучок' (кріп)", () => {
    const q = buildQuery(entry("Кріп", ["кріп", "зелень кропу", "пучок кропу"]));
    expect(q).toBe("кріп");
  });

  it("drops the state modifier 'охолоджене' (куряче філе)", () => {
    const q = buildQuery(entry("Куряче філе", ["куряче філе охолоджене", "філе куряче"]));
    expect(q).toBe("куряче філе");
    expect(q).not.toContain("охолоджен");
  });

  it("drops the digits / percent from 'сметана 20%'", () => {
    expect(buildQuery(entry("Сметана", ["сметана 20%", "сметана 15%"]))).toBe("сметана");
  });

  it("does not strip a real word that starts with a unit letter (гречка)", () => {
    expect(buildQuery(entry("Гречка", ["гречка", "гречана крупа", "ядриця"]))).toBe("гречка");
  });

  it("keeps a two-word head-noun form (олія соняшникова)", () => {
    expect(buildQuery(entry("Олія соняшникова", ["олія", "соняшникова олія"]))).toBe(
      "олія соняшникова",
    );
  });

  it("falls back to a synonym when the name reduces past 3 tokens", () => {
    const q = buildQuery(entry("Дуже довга описова назва продукту тут", ["сир"]));
    expect(q).toBe("сир");
  });
});

describe("chunkQueries", () => {
  it("splits into ≤30-query batches", () => {
    const qs = Array.from({ length: 65 }, (_, i) => `q${i}`);
    expect(chunkQueries(qs).map((c) => c.length)).toEqual([30, 30, 5]);
  });

  it("returns a single batch below the limit", () => {
    expect(chunkQueries(["a", "b"]).length).toBe(1);
  });
});
