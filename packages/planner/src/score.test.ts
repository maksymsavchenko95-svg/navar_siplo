import { describe, expect, it } from "vitest";

import { recipeCost } from "./cost.js";
import { candidate, line, macros, priceMapFor, solverInput } from "./fixtures.js";
import { scoreRecipe, type SolverState } from "./score.js";

const freshState = (over: Partial<SolverState> = {}): SolverState => ({
  budgetLeft: 2000,
  daysLeft: 5,
  pickedIngredientIds: new Set(),
  pickedRecipeIds: new Set(),
  ...over,
});

const scoreOf = (
  c: Parameters<typeof scoreRecipe>[0],
  input: Parameters<typeof scoreRecipe>[3],
  state = freshState(),
) => scoreRecipe(c, recipeCost(c, input), state, input).score;

describe("scoreRecipe (TDD §4 step 3)", () => {
  it("routine: a promo-heavy recipe outscores an identical plain one", () => {
    const promoC = candidate({ recipeId: "promo", ingredients: [line({ id: "p1" })] });
    const plainC = candidate({ recipeId: "plain", ingredients: [line({ id: "q1" })] });
    const prices = new Map([
      ["p1", { uah: 40, promo: true, packSize: 500 }],
      ["q1", { uah: 40, promo: false, packSize: 500 }],
    ]);
    const input = solverInput({ goal: "routine", candidates: [promoC, plainC], prices });
    expect(scoreOf(promoC, input)).toBeGreaterThan(scoreOf(plainC, input));
  });

  it("veg share only matters in form mode", () => {
    const veg = candidate({
      recipeId: "veg",
      ingredients: [
        line({ id: "v1", category: "vegetable" }),
        line({ id: "v2", category: "vegetable" }),
      ],
    });
    const meat = candidate({
      recipeId: "meat",
      ingredients: [line({ id: "m1", category: "meat" }), line({ id: "m2", category: "meat" })],
    });
    const prices = priceMapFor([veg, meat], 40);

    const routine = solverInput({ goal: "routine", candidates: [veg, meat], prices });
    const form = solverInput({ goal: "form", candidates: [veg, meat], prices });

    // routine: veg weight is 0 → veg category is not itself an advantage
    expect(scoreOf(veg, routine)).toBeCloseTo(scoreOf(meat, routine), 5);
    // form: veg weight 1.5 → the vegetable recipe wins
    expect(scoreOf(veg, form)).toBeGreaterThan(scoreOf(meat, form));
  });

  it("reuse rises as the picked-ingredient set grows", () => {
    const c = candidate({
      recipeId: "c",
      ingredients: [line({ id: "shared" }), line({ id: "own" })],
    });
    const input = solverInput({ candidates: [c] });
    const before = scoreOf(c, input, freshState());
    const after = scoreOf(c, input, freshState({ pickedIngredientIds: new Set(["shared"]) }));
    expect(after).toBeGreaterThan(before);
  });

  it("brand term keys off frequentIngredientIds", () => {
    const c = candidate({ recipeId: "b", ingredients: [line({ id: "milk" }), line({ id: "x" })] });
    const plain = solverInput({ candidates: [c] });
    const loyal = solverInput({ candidates: [c], frequentIngredientIds: ["milk"] });
    expect(scoreOf(c, loyal)).toBeGreaterThan(scoreOf(c, plain));
  });
});
