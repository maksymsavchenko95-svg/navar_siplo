import { describe, expect, it } from "vitest";

import { CANONICAL_INGREDIENTS } from "./data/canonical-ingredients.js";
import {
  assertUniqueSlugs,
  ingredientIndex,
  loadRecipeFiles,
  parseCorpus,
  resolveCorpus,
  resolveRecipe,
} from "./import-recipes.js";

/**
 * Corpus-wide guarantees for `data/recipes/*.yaml` — mirrors
 * `data/canonical-ingredients.test.ts`. Runs in `pnpm test` (no DB), so a broken YAML
 * fails CI / the build with a message naming the file (roadmap T1.3 acceptance).
 */

const files = loadRecipeFiles();
const seeds = parseCorpus(files); // throws (naming the file) on any schema / slug error
const dict = ingredientIndex();
const resolved = seeds.map((s) => resolveRecipe(s, dict)); // throws on unknown ingredient / no macros
const dictSlugs = new Set(CANONICAL_INGREDIENTS.map((i) => i.slug));

describe("recipe corpus", () => {
  it("has at least 30 recipes (FR-RECIPE-004)", () => {
    expect(seeds.length).toBeGreaterThanOrEqual(30);
  });

  it("has unique slugs", () => {
    expect(() => assertUniqueSlugs(seeds)).not.toThrow();
  });

  it("resolves end to end without throwing", () => {
    expect(() => resolveCorpus()).not.toThrow();
  });

  it("references only dictionary ingredients, all of which carry macros", () => {
    for (const s of seeds) {
      for (const line of s.ingredients) {
        expect(dictSlugs, `${s.slug} → ${line.slug}`).toContain(line.slug);
        expect(dict.get(line.slug)?.per100g, `${s.slug} → ${line.slug}`).not.toBeNull();
      }
    }
  });

  it("gives every recipe a meal type and at least one season (FR-RECIPE-002/005)", () => {
    for (const s of seeds) {
      expect(["breakfast", "lunch", "dinner", "snack"], s.slug).toContain(s.mealType);
      expect(s.seasons.length, s.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it("carries no fitness / форма tag (ADR-09)", () => {
    for (const r of resolved) {
      for (const tag of r.row.tags) {
        expect(tag.toLowerCase(), r.slug).not.toMatch(/fitness|форма|фітнес/);
      }
    }
  });

  it("computes each recipe's allergen set as the sorted ingredient union (FR-RECIPE-003)", () => {
    for (const r of resolved) {
      const seed = seeds.find((s) => s.slug === r.slug)!;
      const expected = [
        ...new Set(seed.ingredients.flatMap((l) => dict.get(l.slug)?.allergens ?? [])),
      ].sort();
      expect(r.row.allergens, r.slug).toEqual(expected);
    }
  });

  it("produces positive, finite per-serving macros", () => {
    for (const r of resolved) {
      const kcal = Number(r.row.kcalServing);
      const protein = Number(r.row.proteinServing);
      expect(Number.isFinite(kcal) && kcal > 0, r.slug).toBe(true);
      expect(Number.isFinite(protein) && protein >= 0, r.slug).toBe(true);
    }
  });

  it("has at least 12 recipes with >= 25 g protein per serving (form mode, TDD §8 day 6)", () => {
    const highProtein = resolved.filter((r) => Number(r.row.proteinServing) >= 25);
    expect(highProtein.length).toBeGreaterThanOrEqual(12);
  });

  it("is dinner-primary with some breakfast / lunch variety", () => {
    const dinners = seeds.filter((s) => s.mealType === "dinner").length;
    expect(dinners).toBeGreaterThanOrEqual(20);
    expect(seeds.some((s) => s.mealType !== "dinner")).toBe(true);
  });

  it("covers a spread of dietary profiles", () => {
    const withTag = (t: string) => seeds.filter((s) => s.tags.includes(t as never)).length;
    expect(withTag("vegetarian"), "vegetarian").toBeGreaterThanOrEqual(6);
    expect(withTag("lenten"), "lenten").toBeGreaterThanOrEqual(2);
  });

  it("covers a spread of allergen profiles for the safety demo (AC-P0-07)", () => {
    const withAllergen = (a: string) => resolved.filter((r) => r.row.allergens.includes(a)).length;
    expect(withAllergen("milk"), "milk").toBeGreaterThanOrEqual(3);
    expect(withAllergen("gluten"), "gluten").toBeGreaterThanOrEqual(3);
    expect(
      resolved.filter((r) => r.row.allergens.length === 0).length,
      "allergen-free",
    ).toBeGreaterThanOrEqual(6);
  });

  it("reuses ingredients across dishes (FR-PLAN-003 soft goal)", () => {
    const uses = new Map<string, number>();
    for (const s of seeds) {
      for (const l of s.ingredients) uses.set(l.slug, (uses.get(l.slug) ?? 0) + 1);
    }
    const shared = [...uses.values()].filter((n) => n >= 2).length;
    expect(shared).toBeGreaterThanOrEqual(15);
  });
});
