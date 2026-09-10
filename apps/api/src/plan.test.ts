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
  toPlanRecipeView,
} from "./plan.js";
import type { PlanRecipeRow } from "@navar/db";
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
        // weighted: ₴/kg delta × kg, not × pack count → (200-170) × 0.5 = 15
        { isPromo: true, price: "170.00", oldPrice: "200.00", packCount: 1, quantityKg: "0.500" },
      ],
    });
    expect(out.savingsUah).toBe(45);
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

describe("toPlanRecipeView (R2)", () => {
  const row = (item?: Partial<PlanRecipeRow["item"]>, prune = false): PlanRecipeRow => ({
    item: {
      dayIndex: 2,
      titleUk: "Борщ",
      servings: 2,
      portionScale: 1,
      macrosPerServing: { kcal: 520, protein: 28, fat: 18, carbs: 60 },
      ...item,
    },
    recipe: prune
      ? null
      : {
          servings: 4,
          steps: ["Наріжте", "Варіть"],
          totalMinutes: 45,
          activeMinutes: 20,
          difficulty: 2,
          allergens: [],
          ingredients: [
            { nameUk: "Морква", amount: 300, unit: "g", optional: false },
            { nameUk: "Лавровий лист", amount: 2, unit: "pcs", optional: true },
          ],
        },
  });

  it("null row → not_found", () => {
    expect(toPlanRecipeView(null)).toEqual({ status: "not_found" });
  });

  it("pruned recipe → recipe_unavailable with the stored title + day", () => {
    expect(toPlanRecipeView(row(undefined, true))).toEqual({
      status: "recipe_unavailable",
      titleUk: "Борщ",
      dayIndex: 2,
    });
  });

  it("scales ingredient amounts by servings / recipe.servings × portionScale", () => {
    const r = toPlanRecipeView(row()); // 2 / 4 × 1 = 0.5
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.recipe.ingredients).toEqual([
      { nameUk: "Морква", amount: 150, unit: "g", optional: false },
      { nameUk: "Лавровий лист", amount: 1, unit: "pcs", optional: true },
    ]);
  });

  it("applies portionScale and rounds to 1 dp", () => {
    const r = toPlanRecipeView(row({ servings: 3, portionScale: 1.4 }));
    if (r.status !== "ok") throw new Error(r.status);
    // 3 / 4 × 1.4 = 1.05 → 300 × 1.05 = 315
    expect(r.recipe.ingredients[0]!.amount).toBe(315);
  });

  it("passes the item's macro snapshot through untouched", () => {
    const r = toPlanRecipeView(row({ portionScale: 1.4 }));
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.recipe.macrosPerServing).toEqual({ kcal: 520, protein: 28, fat: 18, carbs: 60 });
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
    expect(input.servings).toBe(3); // 2 adults + 1 child, no pets (seed rows, source='silpo')
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
    const stages: string[] = [];
    const res = await generateAndPersistPlan(id, retail, {
      goal: "routine",
      seed: 5,
      detachExplanation: false, // the test asserts the note on return
      onStage: (s) => stages.push(s),
    });
    expect(["ok", "infeasible", "auth_required", "no_cart", "error"]).toContain(res.status);
    // T4.5 — the pipeline reports progress stages in order (a prefix of the full sequence,
    // depending on how far generation got).
    const ORDER = ["context", "pricing", "solving", "saving", "explaining", "done"];
    expect(stages[0]).toBe("context");
    expect(stages).toEqual([...stages].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
    if (res.status === "ok") {
      expect(stages).toEqual(ORDER);
      const { getPlanDetail, schema, db } = await import("@navar/db");
      const { eq } = await import("drizzle-orm");
      const detail = await getPlanDetail(res.planId, id);
      if (!detail) throw new Error("plan not found after persist");
      expect(detail.items.length).toBe(5);
      expect(detail.explanation).toBeTruthy(); // template fallback always fills it
      expect(["llm", "fallback"]).toContain(detail.explanationSource); // never null once explained

      // R0 — the shopping list is sized for 5 dinners × servings, not the whole corpus.
      // A single ingredient across 5 dinners at 3 servings can't plausibly exceed a few kg.
      for (const l of detail.list) {
        if (l.unit === "g" || l.unit === "ml") expect(l.neededAmount).toBeLessThan(6000);
      }
      // R0 + R0b — Σ(price × billed quantity) reconciles with the solver's plan total.
      // The list consolidates across the 5 picks and `recipeCost` counts packs per-recipe
      // (plus it prices unmapped lines with a category median the list leaves null), so the
      // list total sits *at or below* the plan total — never the 2–3× blow-out R0 caused.
      const priced = detail.list.filter((l) => l.price != null);
      const listTotal = priced.reduce((s, l) => s + l.price! * (l.quantityKg ?? l.packCount), 0);
      if (priced.length > 0 && detail.totalEstUah != null && detail.totalEstUah > 0) {
        expect(listTotal).toBeLessThan(detail.totalEstUah * 1.05);
        expect(listTotal).toBeGreaterThan(detail.totalEstUah * 0.5);
      }
      // R0b — a weighted line carries a plausible fractional-kg quantity, never a bare pack.
      for (const l of detail.list) {
        if (l.quantityKg != null) {
          expect(l.quantityKg).toBeGreaterThan(0);
          expect(l.quantityKg).toBeLessThan(5);
        }
      }

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
