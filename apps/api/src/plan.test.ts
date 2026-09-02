import { generatePlan } from "@navar/planner";
import { describe, expect, it } from "vitest";

import { resolveHouseholdId } from "./household.js";
import {
  buildSolverInput,
  generateAndPersistPlan,
  MEAL_SHARE,
  perDinnerTargets,
  PlanInputError,
  toExplainInput,
} from "./plan.js";
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

describe("toExplainInput", () => {
  it("sums promo savings from the shopping list and clamps promoSharePct", () => {
    const out = toExplainInput({
      goal: "routine",
      days: 5,
      budgetUah: 2500,
      totalUah: 2310,
      dishes: ["Борщ", "Плов"],
      promoSharePct: 120, // clamped
      lines: [
        { isPromo: true, price: "40.00", oldPrice: "55.00", packCount: 2 }, // 30 saved
        { isPromo: true, price: "10.00", oldPrice: "8.00", packCount: 1 }, // negative → ignored
        { isPromo: false, price: "99.00", oldPrice: "150.00", packCount: 1 }, // not promo → ignored
      ],
    });
    expect(out.savingsUah).toBe(30);
    expect(out.promoSharePct).toBe(100);
    expect(out.dishes).toEqual(["Борщ", "Плов"]);
  });

  it("tolerates missing / null price fields", () => {
    expect(
      toExplainInput({
        goal: "form",
        days: 5,
        budgetUah: 3000,
        totalUah: 2900,
        dishes: [],
        promoSharePct: 0,
        lines: [{ isPromo: true }, {}],
      }).savingsUah,
    ).toBe(0);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("plan generation (integration)", () => {
  it("form goal without nutrition targets is rejected", async () => {
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    const retail = await getSilpoProvider();
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
    const slugs = new Set(input.candidates.map((c) => c.slug));
    expect(slugs.has("cottage_cheese_syrniki")).toBe(false); // has wheat_flour

    const a = generatePlan(input);
    const b = generatePlan(input);
    expect(a).toEqual(b);
  }, 60_000);

  it("generateAndPersistPlan returns a typed result without throwing", async () => {
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    const retail = await getSilpoProvider();

    // fabricated household → PlanInputError → { status: "error" }
    const missing = await generateAndPersistPlan("00000000-0000-0000-0000-000000000000", retail);
    expect(missing.status).toBe("error");

    // demo household: `ok` when MCP is authed + feasible, otherwise a degraded/typed status.
    const res = await generateAndPersistPlan(id, retail, { goal: "routine", seed: 5 });
    expect(["ok", "infeasible", "auth_required", "no_cart", "error"]).toContain(res.status);
    if (res.status === "ok") {
      const { getPlanDetail, schema, db } = await import("@navar/db");
      const { eq } = await import("drizzle-orm");
      const detail = await getPlanDetail(res.planId, id);
      expect(detail).not.toBeNull();
      expect(detail!.items.length).toBe(5);
      expect(detail!.explanation).toBeTruthy(); // template fallback always fills it
      await db.delete(schema.plans).where(eq(schema.plans.id, res.planId));
    }
  }, 120_000);
});
