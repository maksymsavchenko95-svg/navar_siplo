import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { candidate, line, macros, priceMapFor, solverInput } from "./fixtures.js";
import { generatePlan } from "./generate.js";

const corpus = (n = 12) =>
  Array.from({ length: n }, (_, i) =>
    candidate({
      recipeId: `r${i}`,
      slug: `r${String(i).padStart(2, "0")}`,
      ingredients: [line({ id: `r${i}-a`, amount: 120 }), line({ id: `r${i}-b`, amount: 180 })],
      macrosPerServing: macros({ protein: 48, kcal: 780 }),
    }),
  );

describe("generatePlan — determinism (FR-PLAN-005, AC-P0-09)", () => {
  it("same input + same seed → byte-identical result", () => {
    const cands = corpus();
    const input = () =>
      solverInput({ seed: 7, candidates: cands, prices: priceMapFor(cands, 28), budget: 2200 });
    expect(generatePlan(input())).toEqual(generatePlan(input()));
  });

  it("a different seed gives a different (still valid) plan", () => {
    const cands = corpus();
    const mk = (seed: number) =>
      solverInput({ seed, candidates: cands, prices: priceMapFor(cands, 28), budget: 2200 });
    const a = generatePlan(mk(1));
    const b = generatePlan(mk(999));
    if (!a.feasible || !b.feasible) throw new Error("both should be feasible");
    expect(a.days.map((d) => d.recipeId)).not.toEqual(b.days.map((d) => d.recipeId));
    expect(a.totals.costUah).toBeLessThanOrEqual(2200);
    expect(b.totals.costUah).toBeLessThanOrEqual(2200);
  });

  it("runs the same code path for both goal modes (ADR-09)", () => {
    const cands = corpus();
    const base = { seed: 3, candidates: cands, prices: priceMapFor(cands, 28), budget: 2500 };
    const routine = generatePlan(solverInput({ ...base, goal: "routine" }));
    const form = generatePlan(
      solverInput({
        ...base,
        goal: "form",
        hardConstraints: {
          excludedAllergens: [],
          excludedIngredients: [],
          maxActiveMinutes: 60,
          proteinMinPerDay: 40,
          kcalRange: [600, 1000],
        },
      }),
    );
    expect(routine.feasible).toBe(true);
    expect(form.feasible).toBe(true);
  });
});

describe("ADR-09 — no goal branch below SolverInput", () => {
  it("no solver module branches on goal (goal ===/!==/== ...)", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "fixtures.ts") continue;
      const code = stripComments(readFileSync(`${dir}/${f}`, "utf8"));
      // passing `input.goal` through to the result is fine; branching on its value is not.
      if (/goal\s*(===|!==|==|!=)/.test(code)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
