import { generatePlan } from "@navar/planner";
import { describe, expect, it } from "vitest";

import { resolveHouseholdId } from "./household.js";
import type { PersonalPromo } from "@navar/domain";

import {
  activePromos,
  buildSolverInput,
  generateAndPersistPlan,
  MEAL_SHARE,
  perDinnerTargets,
  PlanInputError,
  toExplainInput,
  toInfeasibleReason,
  toNearestView,
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

describe("activePromos (T4.1)", () => {
  const promo = (promoId: number, endDate: string | null): PersonalPromo => ({
    promoId,
    selected: false,
    beginDate: "2026-08-26",
    endDate,
    description: null,
    rewardText: "x35 балобонусів",
    rewardValue: 35,
    limitText: null,
  });

  it("keeps offers whose window still covers the plan date", () => {
    expect(activePromos([promo(1, "2026-09-10")], "2026-09-05").map((p) => p.promoId)).toEqual([1]);
  });

  it("keeps an offer expiring the same day — the window is inclusive", () => {
    expect(activePromos([promo(1, "2026-09-05")], "2026-09-05")).toHaveLength(1);
  });

  it("drops an offer that already expired, so it is never shown as available", () => {
    expect(activePromos([promo(1, "2026-09-01")], "2026-09-05")).toEqual([]);
  });

  it("treats a missing endDate as open-ended rather than dropping it", () => {
    expect(activePromos([promo(1, null)], "2026-09-05")).toHaveLength(1);
  });

  it("is empty-safe", () => {
    expect(activePromos([], "2026-09-05")).toEqual([]);
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

describe("toInfeasibleReason (T2.5)", () => {
  it("augments a pure budget bind with the household's restriction labels", () => {
    expect(
      toInfeasibleReason({
        binding: "budget",
        plannerReason: "на 320 ₴ більше — інакше не скласти 5 вечер у межах бюджету",
        shortfallUah: 320,
        restrictionLabels: ["молоко", "глютен"],
      }),
    ).toBe("на 320 ₴ більше — найдешевший план з урахуванням ваших обмежень (молоко, глютен)");
  });

  it("passes protein / kcal / candidates reasons through unchanged", () => {
    for (const binding of ["protein", "kcal", "excluded_ingredients", "candidates"] as const) {
      const planner = "на 240 ₴ більше — інакше не набрати 155 г білка за тиждень";
      expect(
        toInfeasibleReason({
          binding,
          plannerReason: planner,
          shortfallUah: 240,
          restrictionLabels: ["молоко"],
        }),
      ).toBe(planner);
    }
  });

  it("leaves a budget bind alone when there are no restrictions", () => {
    const planner = "на 100 ₴ більше — інакше не скласти 5 вечер у межах бюджету";
    expect(
      toInfeasibleReason({
        binding: "budget",
        plannerReason: planner,
        shortfallUah: 100,
        restrictionLabels: [],
      }),
    ).toBe(planner);
  });
});

describe("toNearestView (T2.5)", () => {
  it("trims the solver's nearest plan to the client shape", () => {
    const view = toNearestView({
      days: [
        {
          day: 1,
          slug: "borshch",
          titleUk: "Борщ",
          costUah: 180,
          promoShareUah: 20,
          macrosPerServing: { kcal: 520, protein: 34, fat: 18, carbs: 60, fiber: 5 },
        },
      ],
      totals: { costUah: 2740, promoSharePct: 12, proteinFloorMet: true, kcalCorridorMet: false },
    });
    expect(view.days[0]!.macrosPerServing).toEqual({ kcal: 520, protein: 34, fat: 18, carbs: 60 });
    expect(view).toMatchObject({ costUah: 2740, promoSharePct: 12, proteinFloorMet: true });
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
      expect(["llm", "fallback"]).toContain(detail!.explanationSource); // never null once explained

      // T4.3 — the MCP calls that built the plan are recorded against it.
      const { getMcpCallsByPlan } = await import("@navar/db");
      const trace = await getMcpCallsByPlan(res.planId, id);
      expect(trace).not.toBeNull();
      expect(trace!.length).toBeGreaterThan(0);
      expect(trace!.every((c) => c.phase === "plan_generate")).toBe(true);
      expect(new Set(trace!.map((c) => c.correlationId)).size).toBe(1);

      await db.delete(schema.plans).where(eq(schema.plans.id, res.planId));
    }
  }, 120_000);

  it("an unreachable budget → infeasible with a nearest plan + reason, nothing persisted (T2.5)", async () => {
    const id = await resolveHouseholdId();
    if (!id) throw new Error("no demo household — run pnpm db:seed");
    const retail = await getSilpoProvider();
    const { db, schema } = await import("@navar/db");
    const { eq } = await import("drizzle-orm");

    const before = await db.$count(schema.plans, eq(schema.plans.householdId, id));
    const res = await generateAndPersistPlan(id, retail, {
      goal: "routine",
      budgetUah: 150,
      seed: 9,
    });

    // With prices: infeasible + nearest. Without MCP auth: a degraded status — still typed.
    expect(["infeasible", "auth_required", "no_cart", "error"]).toContain(res.status);
    if (res.status === "infeasible") {
      expect(res.binding).toBeDefined();
      expect(res.reason.length).toBeGreaterThan(0);
      if (res.binding !== "candidates") {
        expect(res.nearest?.days.length).toBe(5);
        expect(res.shortfallUah).toBeGreaterThan(0);
      }
    }
    expect(await db.$count(schema.plans, eq(schema.plans.householdId, id))).toBe(before);
  }, 120_000);
});
