import { describe, expect, it } from "vitest";

import { recipeCost } from "./cost.js";
import { candidate, line, solverInput } from "./fixtures.js";

describe("recipeCost — pack sizes, not grams (TDD §4 step 2)", () => {
  it("buys the smallest sufficient number of packs and records surplus", () => {
    const c = candidate({
      recipeId: "x",
      servings: 3, // no scaling for a 3-person household
      ingredients: [line({ id: "carrot", amount: 300 })],
    });
    const input = solverInput({
      candidates: [c],
      prices: new Map([["carrot", { uah: 25, promo: false, packSize: 400 }]]),
      servings: 3,
    });
    const cost = recipeCost(c, input);
    expect(cost.costUah).toBe(25); // 1 pack
    expect(cost.pantryAfter.get("carrot")).toBe(100); // 400 - 300 left over
  });

  it("draws from the running pantry (surplus carried from an earlier pick)", () => {
    const c = candidate({
      recipeId: "reuse",
      servings: 3,
      ingredients: [line({ id: "paprika", amount: 20 })],
    });
    const input = solverInput({
      candidates: [c],
      prices: new Map([["paprika", { uah: 45, promo: false, packSize: 50 }]]),
      pantry: new Map([["paprika", 50]]), // a full jar left from a previous recipe
      servings: 3,
    });
    const cost = recipeCost(c, input);
    expect(cost.costUah).toBe(0); // nothing bought
    expect(cost.pantryAfter.get("paprika")).toBe(30); // 50 - 20
  });

  it("scales the need by servings / recipe.servings", () => {
    const c = candidate({
      recipeId: "y",
      servings: 4,
      ingredients: [line({ id: "rice", amount: 800 })],
    });
    const input = solverInput({
      candidates: [c],
      prices: new Map([["rice", { uah: 30, promo: false, packSize: 500 }]]),
      servings: 3, // need = 800 * 3/4 = 600 → 2 packs
    });
    expect(recipeCost(c, input).costUah).toBe(60);
  });

  it("counts a promo line into promoShareUah", () => {
    const c = candidate({
      recipeId: "z",
      servings: 3,
      ingredients: [line({ id: "cheese", amount: 200 })],
    });
    const input = solverInput({
      candidates: [c],
      prices: new Map([["cheese", { uah: 90, promo: true, packSize: 200 }]]),
      servings: 3,
    });
    const cost = recipeCost(c, input);
    expect(cost.costUah).toBe(90);
    expect(cost.promoShareUah).toBe(90);
  });

  it("subtracts pantry stock before buying (P0: pantry is empty)", () => {
    const c = candidate({
      recipeId: "p",
      servings: 3,
      ingredients: [line({ id: "oil", amount: 100 })],
    });
    const input = solverInput({
      candidates: [c],
      prices: new Map([["oil", { uah: 50, promo: false, packSize: 900 }]]),
      pantry: new Map([["oil", 100]]),
      servings: 3,
    });
    expect(recipeCost(c, input).costUah).toBe(0); // fully covered by pantry
  });

  it("treats an unmapped non-optional line as 0 cost and reports it", () => {
    const c = candidate({
      recipeId: "u",
      servings: 3,
      ingredients: [line({ id: "exotic", amount: 10 })],
    });
    const cost = recipeCost(c, solverInput({ candidates: [c], prices: new Map(), servings: 3 }));
    expect(cost.costUah).toBe(0);
    expect(cost.unmappedIds).toEqual(["exotic"]);
  });

  it("is deterministic", () => {
    const c = candidate({ recipeId: "d", servings: 3 });
    const input = solverInput({ candidates: [c], servings: 3 });
    expect(recipeCost(c, input)).toEqual(recipeCost(c, input));
  });
});
