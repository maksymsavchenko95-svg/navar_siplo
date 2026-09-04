import { describe, expect, it } from "vitest";

import { candidate, line, macros, priceMapFor, solverInput } from "./fixtures.js";
import { hardFilter } from "./filter.js";

describe("hardFilter (TDD §4 step 1)", () => {
  it("drops a recipe using an excluded ingredient id", () => {
    const bad = candidate({ recipeId: "bad", ingredients: [line({ id: "mushroom" })] });
    const good = candidate({ recipeId: "good" });
    const input = solverInput({
      candidates: [bad, good],
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: ["mushroom"],
        maxActiveMinutes: 60,
      },
    });
    const { kept, droppedReasons } = hardFilter(input);
    expect(kept.map((c) => c.recipeId)).toEqual(["good"]);
    expect(droppedReasons.get("bad")).toMatch(/excluded ingredient/);
  });

  it("drops a recipe over the active-minutes cap", () => {
    const slow = candidate({ recipeId: "slow", activeMinutes: 90 });
    const fast = Array.from({ length: 20 }, (_, i) =>
      candidate({ recipeId: `f${i}`, activeMinutes: 20 }),
    );
    const input = solverInput({
      days: 5,
      candidates: [slow, ...fast],
      hardConstraints: { excludedAllergens: [], excludedIngredients: [], maxActiveMinutes: 40 },
    });
    const { kept, droppedReasons } = hardFilter(input);
    expect(kept.some((c) => c.recipeId === "slow")).toBe(false);
    expect(droppedReasons.get("slow")).toMatch(/activeMinutes/);
  });

  it("form mode: hard-filters on the protein floor and the widened kcal corridor (F4)", () => {
    const lowProt = candidate({ recipeId: "lowp", macrosPerServing: macros({ protein: 20 }) });
    // kcalRange [600, 1200] → widened filter band [360, 1680] (±40% slack, T3.3 tightens it)
    const nearHot = candidate({
      recipeId: "near",
      macrosPerServing: macros({ protein: 50, kcal: 1600 }), // inside the widened band → kept
    });
    const wayHot = candidate({
      recipeId: "way",
      macrosPerServing: macros({ protein: 50, kcal: 2000 }), // beyond widened band → dropped
    });
    const ok = candidate({ recipeId: "ok", macrosPerServing: macros({ protein: 55, kcal: 800 }) });
    const input = solverInput({
      goal: "form",
      candidates: [lowProt, nearHot, wayHot, ok],
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: [],
        maxActiveMinutes: 60,
        proteinMinPerDay: 45,
        kcalRange: [600, 1200],
      },
    });
    const { kept, droppedReasons } = hardFilter(input);
    expect(kept.map((c) => c.recipeId).sort()).toEqual(["near", "ok"]);
    expect(droppedReasons.get("lowp")).toMatch(/protein/);
    expect(droppedReasons.get("way")).toMatch(/kcal .* outside widened corridor/);
  });

  it("drops a recipe with >20% of ingredients unmapped", () => {
    const c = candidate({
      recipeId: "sparse",
      ingredients: [
        line({ id: "a" }),
        line({ id: "b" }),
        line({ id: "c" }),
        line({ id: "d" }),
        line({ id: "e" }),
      ],
    });
    const prices = priceMapFor([c], 40);
    prices.delete("d");
    prices.delete("e"); // 2/5 = 40% unmapped
    expect(hardFilter(solverInput({ candidates: [c], prices })).kept).toHaveLength(0);
  });

  it("opts.kcalSlack overrides the default widened band (T3.3 diagnosis probe)", () => {
    // true range [600, 800]; default 0.4 slack → [360, 1120]; at slack 0 → exactly [600, 800]
    const inDefaultOnly = candidate({
      recipeId: "in-default-only",
      macrosPerServing: macros({ protein: 50, kcal: 1000 }), // inside [360,1120], outside [600,800]
    });
    const inBoth = candidate({
      recipeId: "in-both",
      macrosPerServing: macros({ protein: 50, kcal: 700 }),
    });
    const input = solverInput({
      goal: "form",
      candidates: [inDefaultOnly, inBoth],
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: [],
        maxActiveMinutes: 60,
        proteinMinPerDay: 45,
        kcalRange: [600, 800],
      },
    });
    expect(
      hardFilter(input)
        .kept.map((c) => c.recipeId)
        .sort(),
    ).toEqual(["in-both", "in-default-only"]);
    expect(hardFilter(input, { kcalSlack: 0 }).kept.map((c) => c.recipeId)).toEqual(["in-both"]);
  });

  it("relaxes maxActiveMinutes when fewer than days*3 recipes survive", () => {
    const cands = Array.from({ length: 20 }, (_, i) =>
      candidate({ recipeId: `r${i}`, activeMinutes: 50 }),
    );
    const input = solverInput({
      days: 5,
      candidates: cands,
      hardConstraints: { excludedAllergens: [], excludedIngredients: [], maxActiveMinutes: 30 },
    });
    const { kept, relaxedMinutesTo } = hardFilter(input);
    expect(kept.length).toBeGreaterThanOrEqual(15);
    expect(relaxedMinutesTo).not.toBeNull();
  });
});
