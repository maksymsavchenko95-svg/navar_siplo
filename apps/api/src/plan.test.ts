import { generatePlan } from "@navar/planner";
import { describe, expect, it } from "vitest";

import { resolveHouseholdId } from "./household.js";
import { buildSolverInput, MEAL_SHARE, perDinnerTargets, PlanInputError } from "./plan.js";
import { getSilpoProvider } from "./retail.js";

describe("perDinnerTargets", () => {
  it("scales the demo household's daily targets to a single dinner", () => {
    // demo: 140 g protein, 3060 kcal, ±15%
    expect(perDinnerTargets({ proteinMinG: 140, kcalTarget: 3060, kcalTolerance: 0.15 })).toEqual({
      proteinMinPerDay: 31, // round(140 * 0.22)
      kcalRange: [572, 774], // round(3060 * 0.85 * 0.22), round(3060 * 1.15 * 0.22)
    });
    expect(MEAL_SHARE).toBe(0.22);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("buildSolverInput (integration)", () => {
  it("form goal without nutrition targets is rejected", async () => {
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    const retail = await getSilpoProvider();
    // the seeded demo IS form+targets; a fabricated id has neither
    await expect(
      buildSolverInput("00000000-0000-0000-0000-000000000000", retail),
    ).rejects.toBeInstanceOf(PlanInputError);
  });

  it("builds a SolverInput for the seeded demo household — gluten recipes excluded, form corridor set", async () => {
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    const retail = await getSilpoProvider();

    const input = await buildSolverInput(id, retail, { goal: "form", seed: 3 });
    expect(input.goal).toBe("form");
    expect(input.servings).toBe(3); // 2 adults + 1 child, no pets
    expect(input.hardConstraints.proteinMinPerDay).toBe(31);
    expect(input.hardConstraints.excludedAllergens).toContain("gluten");
    expect(input.candidates.length).toBeGreaterThan(0);
    // no candidate carries a gluten ingredient set (recipes.allergens union filtered upstream)
    const slugs = new Set(input.candidates.map((c) => c.slug));
    expect(slugs.has("cottage_cheese_syrniki")).toBe(false); // has wheat_flour

    // deterministic: same input → identical plan
    const a = generatePlan(input);
    const b = generatePlan(input);
    expect(a).toEqual(b);
  }, 60_000);
});
