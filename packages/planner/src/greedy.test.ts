import { describe, expect, it } from "vitest";

import { candidate, line, macros, priceMapFor, solverInput } from "./fixtures.js";
import { greedyPlan } from "./greedy.js";

/** 10 cheap, distinct, fast recipes — enough for a 5-day plan with slack. */
const corpus = (n = 10) =>
  Array.from({ length: n }, (_, i) =>
    candidate({
      recipeId: `r${i}`,
      slug: `r${String(i).padStart(2, "0")}`,
      ingredients: [line({ id: `r${i}-a`, amount: 150 }), line({ id: `r${i}-b`, amount: 150 })],
      macrosPerServing: macros({ protein: 50, kcal: 750 }),
    }),
  );

describe("greedyPlan (TDD §4 step 4)", () => {
  it("returns 5 distinct dinners within budget", () => {
    const cands = corpus();
    const input = solverInput({
      candidates: cands,
      prices: priceMapFor(cands, 30, { packSize: 500 }),
      budget: 2000,
    });
    const res = greedyPlan(input.candidates, input);
    expect(res.feasible).toBe(true);
    if (!res.feasible) return;
    expect(res.days).toHaveLength(5);
    expect(new Set(res.days.map((d) => d.recipeId)).size).toBe(5);
    expect(res.totals.costUah).toBeLessThanOrEqual(2000);
    expect(res.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it("works in form mode on the same corpus", () => {
    const cands = corpus();
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices: priceMapFor(cands, 30, { packSize: 500 }),
      budget: 2500,
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: [],
        maxActiveMinutes: 60,
        proteinMinPerDay: 45,
        kcalRange: [600, 1000],
      },
    });
    const res = greedyPlan(input.candidates, input);
    expect(res.feasible).toBe(true);
    if (!res.feasible) return;
    expect(res.totals.proteinFloorMet).toBe(true);
    expect(res.totals.kcalCorridorMet).toBe(true);
  });

  it("infeasible on too-small a budget → verdict, not a partial plan", () => {
    const cands = corpus();
    const input = solverInput({
      candidates: cands,
      prices: priceMapFor(cands, 300, { packSize: 100 }), // each recipe ≈ 2 packs × 2 ing × 300 = 1200₴
      budget: 400,
    });
    const res = greedyPlan(input.candidates, input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.reason).toMatch(/бюджет/);
    expect(res.shortfallUah).toBeGreaterThan(0);
  });

  it("infeasible when fewer recipes than days", () => {
    const cands = corpus(3);
    const input = solverInput({ candidates: cands, prices: priceMapFor(cands, 20), budget: 5000 });
    const res = greedyPlan(input.candidates, input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.reason).toMatch(/замало рецептів/);
  });

  it("reports promo share in the totals", () => {
    const cands = corpus();
    const input = solverInput({
      candidates: cands,
      prices: priceMapFor(cands, 30, { promo: true, packSize: 500 }),
      budget: 3000,
    });
    const res = greedyPlan(input.candidates, input);
    if (!res.feasible) throw new Error("expected feasible");
    expect(res.totals.promoSharePct).toBe(100);
  });
});
