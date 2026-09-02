import { CANONICAL_INGREDIENTS } from "@navar/db";
import { canonicalIngredientSchema } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { evaluateQuery, loadGolden } from "./golden.js";
import type { MapperDictEntry } from "./types.js";

/** The real dictionary, keyed by slug, in the shape the mapper consumes. */
const DICT: Map<string, MapperDictEntry> = new Map(
  CANONICAL_INGREDIENTS.map((raw) => {
    const e = canonicalIngredientSchema.parse(raw);
    return [
      e.slug,
      {
        slug: e.slug,
        nameUk: e.nameUk,
        category: e.category,
        baseUnit: e.baseUnit,
        densityGMl: e.densityGMl,
        gramsPerPiece: e.gramsPerPiece,
        synonyms: e.synonyms,
        allergens: e.allergens,
      },
    ];
  }),
);

const PAIRS = loadGolden();

describe("golden mapping dataset (NFR-MNT-003)", () => {
  it("every pair references a real dictionary slug", () => {
    const missing = PAIRS.filter((p) => !DICT.has(p.slug)).map((p) => p.slug);
    expect(missing).toEqual([]);
  });

  it("has at least 40 seeded pairs", () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(40);
  });

  it("every query-side assertion passes (regression guard for query normalisation)", () => {
    const failures: string[] = [];
    let pass = 0;
    for (const pair of PAIRS) {
      const entry = DICT.get(pair.slug);
      if (!entry) continue;
      const out = evaluateQuery(pair, entry);
      if (out.queryPass && out.categoryPass) pass++;
      else
        failures.push(
          `${out.slug}: query="${out.query}" queryPass=${out.queryPass} categoryPass=${out.categoryPass}`,
        );
    }
    // eslint-disable-next-line no-console
    console.info(`golden: ${pass}/${PAIRS.length} query assertions pass`);
    expect(failures).toEqual([]);
  });
});
