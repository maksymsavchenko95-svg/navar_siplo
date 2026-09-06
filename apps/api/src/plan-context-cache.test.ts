import type { SolverInput } from "@navar/planner";
import { WEIGHTS } from "@navar/planner";
import { describe, expect, it } from "vitest";

import { type CachedPlanContext, fromWire, toWire } from "./plan-context-cache.js";

/**
 * T4.2 — the `Map` ↔ entry-array round trip. This is the whole risk of caching the context:
 * `JSON.stringify(new Map())` is `{}`, so a Map that isn't listed in `toWire` disappears
 * silently. Losing `prices` would degrade every edited plan to "free but promoless", and
 * losing `tier` would throw away T4.1's multi-buy pricing.
 */
const ctx = (over: Partial<SolverInput> = {}): CachedPlanContext => ({
  input: {
    seed: 7,
    days: 5,
    budget: 2500,
    servings: 3,
    goal: "routine",
    hardConstraints: { excludedAllergens: [], excludedIngredients: [], maxActiveMinutes: 60 },
    weights: WEIGHTS.routine,
    candidates: [],
    prices: new Map([
      ["milk", { uah: 144, promo: false, packSize: 500, tier: { minCount: 2, price: 114 } }],
      ["oil", { uah: 90, promo: true, packSize: 850, tier: null }],
    ]),
    nutrition: new Map([["milk", { kcal: 60, protein: 3, fat: 3, carbs: 5, fiber: 0 }]]),
    pantry: new Map([["oil", 250]]),
    recentRecipeIds: [],
    frequentIngredientIds: ["milk"],
    ...over,
  } as SolverInput,
  mapperResult: null,
  idBySlug: new Map([["milk", "id-milk"]]),
  recipeSlugIngredients: new Map([["borshch", ["beet", "cabbage"]]]),
});

describe("plan context cache serialisation", () => {
  it("round-trips every Map, including the multi-buy tier", () => {
    const out = fromWire(toWire(ctx()));
    expect(out).toEqual(ctx());
    expect(out.input.prices.get("milk")).toEqual({
      uah: 144,
      promo: false,
      packSize: 500,
      tier: { minCount: 2, price: 114 },
    });
  });

  it("survives an actual JSON hop, which is what Redis stores", () => {
    const out = fromWire(JSON.parse(JSON.stringify(toWire(ctx()))));
    expect(out).toEqual(ctx());
    // The regression this test exists for: a Map left out of `toWire` JSON-ifies to `{}`.
    expect(out.input.prices.size).toBe(2);
    expect(out.input.nutrition.size).toBe(1);
    expect(out.input.pantry.get("oil")).toBe(250);
    expect(out.idBySlug.get("milk")).toBe("id-milk");
    expect(out.recipeSlugIngredients.get("borshch")).toEqual(["beet", "cabbage"]);
  });

  it("keeps the reproducibility triple (seed, budget, goal) intact", () => {
    const out = fromWire(JSON.parse(JSON.stringify(toWire(ctx()))));
    expect([out.input.seed, out.input.budget, out.input.goal]).toEqual([7, 2500, "routine"]);
  });

  it("handles empty maps without collapsing them to undefined", () => {
    const empty = ctx({ prices: new Map(), nutrition: new Map(), pantry: new Map() });
    const out = fromWire(JSON.parse(JSON.stringify(toWire(empty))));
    expect(out.input.prices).toBeInstanceOf(Map);
    expect(out.input.prices.size).toBe(0);
  });
});
