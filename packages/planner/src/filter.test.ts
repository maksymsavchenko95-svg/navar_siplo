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

  it("form mode: hard-filters on the per-dinner protein floor, not the kcal corridor (T3.3)", () => {
    const lowProt = candidate({ recipeId: "lowp", macrosPerServing: macros({ protein: 20 }) });
    const hotKcal = candidate({
      recipeId: "hot",
      macrosPerServing: macros({ protein: 50, kcal: 1600 }),
    });
    const ok = candidate({ recipeId: "ok", macrosPerServing: macros({ protein: 55, kcal: 800 }) });
    const input = solverInput({
      goal: "form",
      candidates: [lowProt, hotKcal, ok],
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: [],
        maxActiveMinutes: 60,
        proteinMinPerDay: 45,
        kcalRange: [600, 1200],
      },
    });
    const { kept } = hardFilter(input);
    // lowProt dropped (protein < 45); hotKcal stays (kcal corridor is not a hard filter yet)
    expect(kept.map((c) => c.recipeId).sort()).toEqual(["hot", "ok"]);
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
