import { describe, expect, it } from "vitest";

import { generatePlan } from "./generate.js";
import { hardFilter } from "./filter.js";
import { candidate, line, macros, solverInput, priceMapFor } from "./fixtures.js";
import { cheapestPlan, diagnoseInfeasible } from "./nearest.js";
import type { RecipeCandidate, SolverInput } from "./contract.js";

type PriceEntry = SolverInput["prices"] extends Map<string, infer V> ? V : never;

/** `[ingredientId, price]` tuples for every line of `cs`, at a flat per-unit price. */
function priceTier(cs: readonly RecipeCandidate[], uah: number): [string, PriceEntry][] {
  return cs.flatMap((c) =>
    c.ingredients.map((l) => [l.id, { uah, promo: false, packSize: 500 }] as [string, PriceEntry]),
  );
}

/** N candidates, 2 ingredients each, given per-serving macros + a price tier. */
function corpus(
  n: number,
  opts: { protein?: number; kcal?: number; idPrefix?: string; slugPrefix?: string } = {},
): RecipeCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    candidate({
      recipeId: `${opts.idPrefix ?? "r"}${i}`,
      slug: `${opts.slugPrefix ?? "r"}${String(i).padStart(2, "0")}`,
      ingredients: [
        line({ id: `${opts.idPrefix ?? "r"}${i}-a`, amount: 150 }),
        line({ id: `${opts.idPrefix ?? "r"}${i}-b`, amount: 150 }),
      ],
      macrosPerServing: macros({ protein: opts.protein ?? 45, kcal: opts.kcal ?? 700 }),
    }),
  );
}

describe("cheapestPlan", () => {
  it("picks the `days` lowest-cost distinct recipes", () => {
    const cands = corpus(8);
    const prices = new Map(
      cands.flatMap((c, i) =>
        c.ingredients.map((l) => [l.id, { uah: 10 + i, promo: false, packSize: 500 }] as const),
      ),
    );
    const input = solverInput({ candidates: cands, prices, budget: 999999 });
    const res = cheapestPlan(hardFilter(input).kept, input);
    expect(res.feasible).toBe(true);
    if (!res.feasible) return;
    // recipes r0..r4 are the 5 cheapest
    expect(res.days.map((d) => d.slug).sort()).toEqual(["r00", "r01", "r02", "r03", "r04"]);
  });

  it("is deterministic and independent of candidate order / seed", () => {
    const cands = corpus(7);
    const prices = priceMapFor(cands, 30, { packSize: 500 });
    const a = cheapestPlan(hardFilter(solverInput({ candidates: cands, prices, seed: 1 })).kept, {
      ...solverInput({ candidates: cands, prices, seed: 1 }),
    });
    const b = cheapestPlan(
      hardFilter(solverInput({ candidates: [...cands].reverse(), prices, seed: 999 })).kept,
      solverInput({ candidates: [...cands].reverse(), prices, seed: 999 }),
    );
    if (!a.feasible || !b.feasible) throw new Error("both feasible");
    expect(a.days.map((d) => d.slug)).toEqual(b.days.map((d) => d.slug));
  });

  it("infeasible when fewer than `days` recipes survive", () => {
    const cands = corpus(3);
    const input = solverInput({ candidates: cands, prices: priceMapFor(cands, 20) });
    const res = cheapestPlan(input.candidates, input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.binding).toBe("candidates");
  });
});

describe("diagnoseInfeasible — binding constraint", () => {
  it("budget: no restrictions, corpus just costs more", () => {
    const cands = corpus(8);
    const input = solverInput({
      candidates: cands,
      prices: priceMapFor(cands, 300, { packSize: 100 }), // ~2 packs × 2 ing × 300 ≈ 1200 / recipe
      budget: 1500,
    });
    const res = generatePlan(input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.binding).toBe("budget");
    expect(res.nearest).toBeDefined();
    expect(res.shortfallUah).toBe(res.nearest!.totals.costUah - input.budget);
    expect(res.shortfallUah).toBeGreaterThan(0);
    expect(res.reason).toMatch(/бюджет/);
  });

  it("protein: the daily protein floor pushes the cheapest valid plan over budget (form)", () => {
    const cheap = corpus(5, { protein: 20, idPrefix: "c", slugPrefix: "c" }); // < floor → filtered
    const rich = corpus(6, { protein: 55, idPrefix: "h", slugPrefix: "h" });
    const cands = [...cheap, ...rich];
    const prices = new Map([...priceTier(cheap, 50), ...priceTier(rich, 400)]);
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices,
      budget: 2500,
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: [],
        maxActiveMinutes: 60,
        proteinMinPerDay: 40,
        kcalRange: [400, 1200],
      },
    });
    const res = generatePlan(input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.binding).toBe("protein");
    expect(res.shortfallProteinG).toBeGreaterThan(0);
    expect(res.reason).toMatch(/білка/);
    expect(res.nearest!.totals.proteinFloorMet).toBe(true); // the nearest plan still honours it
  });

  it("kcal: the corridor pushes the cheapest valid plan over budget (form)", () => {
    const hot = corpus(5, { kcal: 1600, protein: 55, idPrefix: "k", slugPrefix: "k" }); // outside widened band
    const ok = corpus(6, { kcal: 700, protein: 55, idPrefix: "o", slugPrefix: "o" });
    const cands = [...hot, ...ok];
    const prices = new Map([...priceTier(hot, 50), ...priceTier(ok, 400)]);
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices,
      budget: 2500,
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: [],
        maxActiveMinutes: 60,
        proteinMinPerDay: 30,
        kcalRange: [600, 800], // widened filter band ≈ [360, 1120] → hot (1600) excluded
      },
    });
    const res = generatePlan(input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.binding).toBe("kcal");
    expect(res.reason).toMatch(/коридор/);
  });

  it("portion: portion-scaling alone (T3.3) would rescue the corridor, just not in budget", () => {
    // true range [600, 800]; default widened band ≈ [360, 1120] excludes kcal=1200;
    // portion-extended band [600/1.4≈429, 800/0.6≈1333] includes it.
    const rescuable = corpus(5, { kcal: 1200, protein: 55, idPrefix: "p", slugPrefix: "p" });
    const ok = corpus(6, { kcal: 700, protein: 55, idPrefix: "o2", slugPrefix: "o2" });
    const cands = [...rescuable, ...ok];
    const prices = new Map([...priceTier(rescuable, 50), ...priceTier(ok, 400)]);
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices,
      budget: 2500,
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: [],
        maxActiveMinutes: 60,
        proteinMinPerDay: 30,
        kcalRange: [600, 800],
      },
    });
    const res = generatePlan(input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.binding).toBe("portion");
    expect(res.reason).toMatch(/розмір[уі] порції/);
  });

  it("excluded_ingredients: a strict dislike removes the cheap options", () => {
    const banned = corpus(5, { idPrefix: "b", slugPrefix: "b" }).map((c) => ({
      ...c,
      ingredients: [
        line({ id: "DISLIKED", amount: 150 }),
        line({ id: `${c.recipeId}-b`, amount: 150 }),
      ],
    }));
    const normal = corpus(6, { idPrefix: "n", slugPrefix: "n" });
    const cands = [...banned, ...normal];
    const prices = new Map<string, PriceEntry>([
      ["DISLIKED", { uah: 30, promo: false, packSize: 500 }],
      ...banned.flatMap((c) => priceTier([{ ...c, ingredients: c.ingredients.slice(1) }], 30)),
      ...priceTier(normal, 400),
    ]);
    const input = solverInput({
      candidates: cands,
      prices,
      budget: 2500,
      hardConstraints: {
        excludedAllergens: [],
        excludedIngredients: ["DISLIKED"],
        maxActiveMinutes: 60,
      },
    });
    const res = generatePlan(input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.binding).toBe("excluded_ingredients");
    expect(res.reason).toMatch(/виключен/);
  });

  it("candidates: fewer than `days` recipes survive → no nearest plan", () => {
    const cands = corpus(3);
    const input = solverInput({ candidates: cands, prices: priceMapFor(cands, 20), budget: 99999 });
    const res = generatePlan(input);
    expect(res.feasible).toBe(false);
    if (res.feasible) return;
    expect(res.binding).toBe("candidates");
    expect(res.nearest).toBeUndefined();
    expect(res.reason).toMatch(/замало рецептів/);
  });

  it("is deterministic", () => {
    const cands = corpus(8);
    const mk = () =>
      solverInput({
        candidates: cands,
        prices: priceMapFor(cands, 300, { packSize: 100 }),
        budget: 1500,
        seed: 4,
      });
    expect(diagnoseInfeasible(mk(), hardFilter(mk()))).toEqual(
      diagnoseInfeasible(mk(), hardFilter(mk())),
    );
  });
});
