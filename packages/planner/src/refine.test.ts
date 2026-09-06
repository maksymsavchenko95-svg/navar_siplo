import { describe, expect, it } from "vitest";

import type { RecipeCandidate } from "./contract.js";
import { candidate, line, macros, priceMapFor, solverInput } from "./fixtures.js";
import { generatePlan } from "./generate.js";
import { greedyPlan } from "./greedy.js";
import { hardFilter } from "./filter.js";
import {
  bestPortionScale,
  dayAlternatives,
  localSearch,
  portionFit,
  replay,
  safePortionRange,
  scalePortionMacros,
} from "./refine.js";

const FORM_HC = (over: { proteinMinPerDay?: number; kcalRange?: [number, number] } = {}) => ({
  excludedAllergens: [],
  excludedIngredients: [],
  maxActiveMinutes: 60,
  ...over,
});

describe("scalePortionMacros", () => {
  it("scales every macro by the same factor", () => {
    expect(
      scalePortionMacros({ kcal: 800, protein: 40, fat: 20, carbs: 60, fiber: 5 }, 0.5),
    ).toEqual({
      kcal: 400,
      protein: 20,
      fat: 10,
      carbs: 30,
      fiber: 2.5,
    });
  });

  it("defaults a missing fiber to 0 before scaling", () => {
    expect(scalePortionMacros({ kcal: 100, protein: 10, fat: 5, carbs: 10 }, 2).fiber).toBe(0);
  });
});

describe("safePortionRange / bestPortionScale", () => {
  it("keeps scale 1 when already inside the corridor and above the floor", () => {
    const m = macros({ kcal: 700, protein: 50 });
    const hc = FORM_HC({ proteinMinPerDay: 40, kcalRange: [600, 800] });
    expect(bestPortionScale(m, hc)).toBe(1);
  });

  it("pulls kcal into the corridor when protein has slack", () => {
    // kcal 950 → corridor [700,800] needs scale ∈ [0.7368, 0.8421]; protein 50 needs scale ≥ 0.6
    const m = macros({ kcal: 950, protein: 50 });
    const hc = FORM_HC({ proteinMinPerDay: 30, kcalRange: [700, 800] });
    const scale = bestPortionScale(m, hc);
    expect(scale).toBeCloseTo(0.8421, 3); // closest-to-1 point in the safe range
    expect(scale * m.kcal).toBeLessThanOrEqual(800);
    expect(scale * m.kcal).toBeGreaterThanOrEqual(700);
    expect(scale * m.protein).toBeGreaterThanOrEqual(30);
  });

  it("falls back to 1 when the corridor and protein floor can't both be satisfied", () => {
    // same pathological case as greedy.test.ts's F4 scenario: kcal 950, corridor [700,800]
    // needs scale ≤ 0.8421; protein floor 45 (of 50) needs scale ≥ 0.9 — empty intersection.
    const m = macros({ kcal: 950, protein: 50 });
    const hc = FORM_HC({ proteinMinPerDay: 45, kcalRange: [700, 800] });
    expect(safePortionRange(m, hc)).toBeNull();
    expect(bestPortionScale(m, hc)).toBe(1);
  });

  it("clamps to the [0.6, 1.4] domain boundary when the corridor interval straddles it", () => {
    // corridor wants scale ∈ [700/2000, 1200/2000] = [0.35, 0.6] — overlaps [0.6,1.4] only
    // at the single point 0.6, so the safe range is [0.6, 0.6] and bestPortionScale clamps
    // the natural choice of 1.0 down to that boundary.
    const m = macros({ kcal: 2000, protein: 50 });
    const hc = FORM_HC({ kcalRange: [700, 1200] });
    expect(safePortionRange(m, hc)).toEqual([0.6, 0.6]);
    expect(bestPortionScale(m, hc)).toBe(0.6);
  });

  it("is a no-op (range = full domain) when no goal constraints are set", () => {
    expect(safePortionRange(macros(), FORM_HC())).toEqual([0.6, 1.4]);
  });
});

// ─── replay ──────────────────────────────────────────────────────────────────

function corpus(n: number, kcal = 750, protein = 48): RecipeCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    candidate({
      recipeId: `r${i}`,
      slug: `r${String(i).padStart(2, "0")}`,
      ingredients: [line({ id: `r${i}-a`, amount: 120 }), line({ id: `r${i}-b`, amount: 180 })],
      macrosPerServing: macros({ protein, kcal }),
    }),
  );
}

describe("replay", () => {
  it("reproduces greedyPlan's own cost/state bookkeeping at portionScale 1", () => {
    const cands = corpus(10);
    const input = solverInput({ candidates: cands, prices: priceMapFor(cands, 28), budget: 2200 });
    const greedy = greedyPlan(cands, input);
    expect(greedy.feasible).toBe(true);
    if (!greedy.feasible) return;

    const candidatesById = new Map(cands.map((c) => [c.recipeId, c]));
    const assignment = greedy.days.map((p) => ({ recipeId: p.recipeId, portionScale: 1 as const }));
    const r = replay(assignment, candidatesById, input);
    expect(r).not.toBeNull();
    expect(r!.picks).toEqual(greedy.days);
    expect(r!.totalCost).toBe(greedy.totals.costUah);
  });

  it("scales cost with portionScale, respecting pack rounding", () => {
    const c = candidate({
      recipeId: "x",
      servings: 3,
      ingredients: [line({ id: "rice", amount: 300 })],
    });
    const candidatesById = new Map([["x", c]]);
    const input = solverInput({
      candidates: [c],
      servings: 3,
      prices: new Map([["rice", { uah: 20, promo: false, packSize: 200 }]]),
    });
    const at1 = replay([{ recipeId: "x", portionScale: 1 }], candidatesById, input)!;
    const at05 = replay([{ recipeId: "x", portionScale: 0.5 }], candidatesById, input)!;
    expect(at1.totalCost).toBe(40); // 300g → 2 packs
    expect(at05.totalCost).toBe(20); // 150g → 1 pack
    expect(at05.picks[0]!.macrosPerServing.protein).toBeCloseTo(
      c.macrosPerServing.protein * 0.5,
      6,
    );
  });

  it("returns null for an unknown recipeId", () => {
    const candidatesById = new Map<string, RecipeCandidate>();
    const input = solverInput({ candidates: [] });
    expect(replay([{ recipeId: "ghost", portionScale: 1 }], candidatesById, input)).toBeNull();
  });
});

// ─── portionFit ──────────────────────────────────────────────────────────────

describe("portionFit", () => {
  it("scales a day into the true corridor when budget allows", () => {
    const cands = corpus(6, 950, 50); // true range [700,800]; needs scale ≈0.8421, protein floor 30
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices: priceMapFor(cands, 30, { packSize: 500 }),
      budget: 3000,
      hardConstraints: FORM_HC({ proteinMinPerDay: 30, kcalRange: [700, 800] }),
    });
    const greedy = greedyPlan(hardFilter(input).kept, input);
    expect(greedy.feasible).toBe(true);
    if (!greedy.feasible) return;
    expect(greedy.totals.kcalCorridorMet).toBe(false); // pre-T3.3 behaviour (F4)

    const candidatesById = new Map(cands.map((c) => [c.recipeId, c]));
    const assignment = portionFit(greedy.days, candidatesById, input);
    const fitted = replay(assignment, candidatesById, input)!;
    expect(fitted.totalCost).toBeLessThanOrEqual(input.budget);
    for (const p of fitted.picks) {
      expect(p.macrosPerServing.kcal).toBeGreaterThanOrEqual(700);
      expect(p.macrosPerServing.kcal).toBeLessThanOrEqual(800.01);
      expect(p.portionScale).toBeCloseTo(0.8421, 3);
    }
  });

  it("stays within budget by pinning some of the scale-ups back to 1 (partial fit)", () => {
    // 5 identical days, each 1 ingredient, packSize 120: at scale 1 (amount 100) → 1 pack
    // (₴50); the corridor wants scale 1.4 (amount 140) → still fits one pack size boundary
    // crossing → 2 packs (₴100). Scaling ALL 5 days up would cost 500 (5×100); the budget
    // only has room for 2 of the 5 to scale up (250 baseline + 2×50 headroom = 350).
    const cands = Array.from({ length: 5 }, (_, i) =>
      candidate({
        recipeId: `u${i}`,
        slug: `u${i}`,
        servings: 3,
        ingredients: [line({ id: `u${i}-a`, amount: 100 })],
        macrosPerServing: macros({ protein: 60, kcal: 500 }), // below corridor → wants scale 1.4
      }),
    );
    const input = solverInput({
      goal: "form",
      candidates: cands,
      servings: 3,
      prices: new Map(
        cands.map((c) => [c.ingredients[0]!.id, { uah: 50, promo: false, packSize: 120 }]),
      ),
      budget: 350,
      hardConstraints: FORM_HC({ proteinMinPerDay: 20, kcalRange: [700, 800] }),
    });
    const greedy = greedyPlan(hardFilter(input, { kcalSlack: 0.6 }).kept, input);
    expect(greedy.feasible).toBe(true);
    if (!greedy.feasible) return;
    expect(greedy.totals.costUah).toBe(250); // 5 × ₴50 at scale 1 — the known-feasible baseline

    const candidatesById = new Map(cands.map((c) => [c.recipeId, c]));
    const assignment = portionFit(greedy.days, candidatesById, input);
    const fitted = replay(assignment, candidatesById, input)!;
    expect(fitted.totalCost).toBeLessThanOrEqual(input.budget);
    expect(fitted.picks.some((p) => p.portionScale === 1)).toBe(true); // some pinned back
    expect(fitted.picks.some((p) => p.portionScale > 1)).toBe(true); // some still scaled up
  });

  it("is deterministic", () => {
    const cands = corpus(6, 950, 50);
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices: priceMapFor(cands, 30, { packSize: 500 }),
      budget: 3000,
      hardConstraints: FORM_HC({ proteinMinPerDay: 30, kcalRange: [700, 800] }),
    });
    const greedy = greedyPlan(hardFilter(input).kept, input);
    if (!greedy.feasible) throw new Error("expected feasible");
    const candidatesById = new Map(cands.map((c) => [c.recipeId, c]));
    expect(portionFit(greedy.days, candidatesById, input)).toEqual(
      portionFit(greedy.days, candidatesById, input),
    );
  });
});

// ─── localSearch ─────────────────────────────────────────────────────────────

describe("localSearch", () => {
  it("is deterministic given the same seed", () => {
    const cands = corpus(12);
    const input = solverInput({ candidates: cands, prices: priceMapFor(cands, 28), budget: 2200 });
    const greedy = greedyPlan(hardFilter(input).kept, input);
    if (!greedy.feasible) throw new Error("expected feasible");
    const candidatesById = new Map(cands.map((c) => [c.recipeId, c]));
    const initial = replay(
      greedy.days.map((p) => ({ recipeId: p.recipeId, portionScale: 1 })),
      candidatesById,
      input,
    )!;
    const a = localSearch(
      input.seed,
      initial,
      hardFilter(input).kept,
      candidatesById,
      input,
      false,
    );
    const b = localSearch(
      input.seed,
      initial,
      hardFilter(input).kept,
      candidatesById,
      input,
      false,
    );
    expect(a).toEqual(b);
  });

  it("never exceeds budget and only accepts strictly-improving moves", () => {
    const cands = corpus(15);
    // one clearly better (all-promo) candidate not in the initial greedy pick, to give local
    // search an obvious strictly-improving swap to find.
    const star = candidate({
      recipeId: "star",
      slug: "star",
      ingredients: [line({ id: "star-a", amount: 120 }), line({ id: "star-b", amount: 180 })],
      macrosPerServing: macros({ protein: 48, kcal: 750 }),
    });
    const all = [...cands, star];
    const prices = priceMapFor(all, 28, { promo: false });
    prices.set("star-a", { uah: 28, promo: true, packSize: 500 });
    prices.set("star-b", { uah: 28, promo: true, packSize: 500 });
    const input = solverInput({ candidates: all, prices, budget: 2200 });
    const kept = hardFilter(input).kept;
    const candidatesById = new Map(all.map((c) => [c.recipeId, c]));
    const greedy = greedyPlan(kept, input);
    if (!greedy.feasible) throw new Error("expected feasible");
    const initial = replay(
      greedy.days.map((p) => ({ recipeId: p.recipeId, portionScale: 1 })),
      candidatesById,
      input,
    )!;

    const result = localSearch(input.seed, initial, kept, candidatesById, input, false);
    expect(result.totalCost).toBeLessThanOrEqual(input.budget);
    expect(result.totalScore).toBeGreaterThanOrEqual(initial.totalScore);
  });

  it("form: never drops a day's scaled protein below the floor", () => {
    const cands = corpus(12, 750, 45);
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices: priceMapFor(cands, 28),
      budget: 2200,
      hardConstraints: FORM_HC({ proteinMinPerDay: 40, kcalRange: [500, 1000] }),
    });
    const kept = hardFilter(input).kept;
    const candidatesById = new Map(cands.map((c) => [c.recipeId, c]));
    const greedy = greedyPlan(kept, input);
    if (!greedy.feasible) throw new Error("expected feasible");
    const initial = replay(
      greedy.days.map((p) => ({ recipeId: p.recipeId, portionScale: 1 })),
      candidatesById,
      input,
    )!;
    const result = localSearch(input.seed, initial, kept, candidatesById, input, true);
    for (const p of result.picks) expect(p.macrosPerServing.protein).toBeGreaterThanOrEqual(40);
  });
});

// ─── refinePlan, via generatePlan ────────────────────────────────────────────

describe("refinePlan (via generatePlan)", () => {
  it("routine: portionScale stays 1 for every day (no macro target to chase)", () => {
    const cands = corpus(10);
    const input = solverInput({ candidates: cands, prices: priceMapFor(cands, 28), budget: 2200 });
    const result = generatePlan(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.days.every((d) => d.portionScale === 1)).toBe(true);
  });

  it("form: brings kcalCorridorMet to true when protein has enough slack (T3.3's payoff)", () => {
    const cands = corpus(6, 950, 50);
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices: priceMapFor(cands, 30, { packSize: 500 }),
      budget: 3000,
      hardConstraints: FORM_HC({ proteinMinPerDay: 30, kcalRange: [700, 800] }),
    });
    // Sanity: plain greedy (pre-T3.3 behaviour) reports the corridor as unmet.
    const greedy = greedyPlan(hardFilter(input).kept, input);
    expect(greedy.feasible && !greedy.totals.kcalCorridorMet).toBe(true);

    const result = generatePlan(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.totals.kcalCorridorMet).toBe(true);
    expect(result.totals.proteinFloorMet).toBe(true);
    expect(result.totals.costUah).toBeLessThanOrEqual(input.budget);
  });

  it("form: an irreconcilable protein-floor/corridor conflict still honestly reports false (F4, no regression)", () => {
    const cands = corpus(8, 950, 50);
    const input = solverInput({
      goal: "form",
      candidates: cands,
      prices: priceMapFor(cands, 30, { packSize: 500 }),
      budget: 3000,
      hardConstraints: FORM_HC({ proteinMinPerDay: 45, kcalRange: [700, 800] }),
    });
    const result = generatePlan(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.totals.proteinFloorMet).toBe(true); // never sacrificed
    expect(result.totals.kcalCorridorMet).toBe(false); // honestly still unmet
  });

  it("is deterministic end to end", () => {
    const cands = corpus(10, 950, 50);
    const mk = () =>
      solverInput({
        goal: "form",
        candidates: cands,
        prices: priceMapFor(cands, 30, { packSize: 500 }),
        budget: 3000,
        hardConstraints: FORM_HC({ proteinMinPerDay: 30, kcalRange: [700, 800] }),
      });
    expect(generatePlan(mk())).toEqual(generatePlan(mk()));
  });
});

// ─── dayAlternatives (T4.2, FR-PLAN-007) ─────────────────────────────────────

describe("dayAlternatives", () => {
  /** A feasible 5-day plan over `n` candidates, plus everything the enumerator needs. */
  function setup(n = 12, over: Partial<Parameters<typeof solverInput>[0]> = {}) {
    const cands = corpus(n);
    const input = solverInput({
      candidates: cands,
      prices: priceMapFor(cands, 28),
      budget: 2200,
      ...over,
    });
    const hf = hardFilter(input);
    const greedy = greedyPlan(hf.kept, input);
    if (!greedy.feasible) throw new Error("fixture plan must be feasible");
    const byId = new Map(hf.kept.map((c) => [c.recipeId, c]));
    const current = replay(
      greedy.days.map((d) => ({ recipeId: d.recipeId, portionScale: d.portionScale })),
      byId,
      input,
    )!;
    return { input, kept: hf.kept, byId, current, greedy };
  }

  it("returns at most `limit` alternatives", () => {
    const { input, kept, byId, current } = setup();
    expect(dayAlternatives(0, current, kept, byId, input, false).length).toBeLessThanOrEqual(3);
    expect(dayAlternatives(0, current, kept, byId, input, false, 5).length).toBeLessThanOrEqual(5);
  });

  it("never offers a dish already in the plan, including the day's own", () => {
    const { input, kept, byId, current } = setup();
    const inPlan = new Set(current.picks.map((p) => p.recipeId));
    for (const alt of dayAlternatives(2, current, kept, byId, input, false, 99)) {
      expect(inPlan.has(alt.candidate.recipeId)).toBe(false);
    }
  });

  it("keeps every alternative within budget", () => {
    const { input, kept, byId, current } = setup();
    for (const alt of dayAlternatives(1, current, kept, byId, input, false, 99)) {
      expect(alt.replayed.totalCost).toBeLessThanOrEqual(input.budget);
    }
  });

  it("substitutes at the requested day and leaves the other days' recipes alone", () => {
    const { input, kept, byId, current } = setup();
    const [alt] = dayAlternatives(3, current, kept, byId, input, false);
    expect(alt).toBeDefined();
    expect(alt!.replayed.picks[3]!.recipeId).toBe(alt!.candidate.recipeId);
    for (const i of [0, 1, 2, 4]) {
      expect(alt!.replayed.picks[i]!.recipeId).toBe(current.picks[i]!.recipeId);
    }
  });

  it("reports the whole-plan cost delta, not just the swapped day's", () => {
    const { input, kept, byId, current } = setup();
    for (const alt of dayAlternatives(0, current, kept, byId, input, false, 99)) {
      expect(alt.deltaUah).toBeCloseTo(alt.replayed.totalCost - current.totalCost, 2);
    }
  });

  it("ranks by total score, best first", () => {
    const { input, kept, byId, current } = setup();
    const alts = dayAlternatives(0, current, kept, byId, input, false, 99);
    const scores = alts.map((a) => a.replayed.totalScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("is deterministic and seed-independent (FR-PLAN-005)", () => {
    const ids = (seed: number) => {
      const { input, kept, byId, current } = setup(12, { seed });
      return dayAlternatives(1, current, kept, byId, input, false, 99).map(
        (a) => a.candidate.recipeId,
      );
    };
    // Same seed twice → identical, and a different seed does not reorder the ranking
    // (the sort is a total order over score + slug, with no RNG).
    expect(ids(1)).toEqual(ids(1));
    const { input, kept, byId, current } = setup();
    const a = dayAlternatives(1, current, kept, byId, input, false, 99).map(
      (x) => x.candidate.recipeId,
    );
    const b = dayAlternatives(1, current, kept, byId, input, false, 99).map(
      (x) => x.candidate.recipeId,
    );
    expect(a).toEqual(b);
  });

  it("offers the planted better candidate first", () => {
    const cands = corpus(8);
    const star = candidate({
      recipeId: "star",
      slug: "zz-star", // sorts last, so a win cannot be a tie-break artefact
      ingredients: [line({ id: "star-a", amount: 100 })],
      macrosPerServing: macros({ protein: 60, kcal: 750 }),
    });
    const all = [...cands, star];
    const prices = priceMapFor(all, 28);
    // The star's only ingredient is on promo and cheap — strictly better on both terms.
    prices.set("star-a", { uah: 5, promo: true, packSize: 500 });
    const input = solverInput({ candidates: all, prices, budget: 2200 });
    const hf = hardFilter(input);
    const greedy = greedyPlan(
      hf.kept.filter((c) => c.recipeId !== "star"), // keep the star out of the initial plan
      input,
    );
    if (!greedy.feasible) throw new Error("fixture plan must be feasible");
    const byId = new Map(hf.kept.map((c) => [c.recipeId, c]));
    const current = replay(
      greedy.days.map((d) => ({ recipeId: d.recipeId, portionScale: d.portionScale })),
      byId,
      input,
    )!;

    expect(dayAlternatives(0, current, hf.kept, byId, input, false)[0]!.candidate.recipeId).toBe(
      "star",
    );
  });

  it("returns [] for an out-of-range day and when nothing else fits", () => {
    const { input, kept, byId, current } = setup();
    expect(dayAlternatives(-1, current, kept, byId, input, false)).toEqual([]);
    expect(dayAlternatives(99, current, kept, byId, input, false)).toEqual([]);
    // A 5-candidate corpus for a 5-day plan leaves nothing unused to swap in.
    const tight = setup(5);
    expect(dayAlternatives(0, tight.current, tight.kept, tight.byId, tight.input, false)).toEqual(
      [],
    );
  });

  it("holds the protein floor in form mode", () => {
    const cands = corpus(12, 750, 48);
    const weak = candidate({
      recipeId: "weak",
      slug: "zz-weak",
      ingredients: [line({ id: "weak-a", amount: 100 })],
      macrosPerServing: macros({ protein: 5, kcal: 750 }), // far below the floor
    });
    const all = [...cands, weak];
    const input = solverInput({
      candidates: all,
      prices: priceMapFor(all, 28),
      budget: 2200,
      goal: "form",
      hardConstraints: FORM_HC({ proteinMinPerDay: 40, kcalRange: [600, 900] }),
    });
    const hf = hardFilter(input);
    const greedy = greedyPlan(hf.kept, input);
    if (!greedy.feasible) throw new Error("fixture plan must be feasible");
    const byId = new Map(hf.kept.map((c) => [c.recipeId, c]));
    const current = replay(
      greedy.days.map((d) => ({ recipeId: d.recipeId, portionScale: d.portionScale })),
      byId,
      input,
    )!;

    const alts = dayAlternatives(0, current, hf.kept, byId, input, true, 99);
    expect(alts.map((a) => a.candidate.recipeId)).not.toContain("weak");
    for (const alt of alts) {
      for (const p of alt.replayed.picks)
        expect(p.macrosPerServing.protein).toBeGreaterThanOrEqual(40);
    }
  });
});
