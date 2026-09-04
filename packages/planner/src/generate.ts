import type { SolverInput, SolverResult } from "./contract.js";
import { hardFilter } from "./filter.js";
import { greedyPlan } from "./greedy.js";
import { diagnoseInfeasible } from "./nearest.js";
import { refinePlan } from "./refine.js";

/**
 * The deterministic meal-plan solver (TDD §4 steps 1–6). Same `SolverInput` + same `seed`
 * → byte-identical `SolverResult` (`AC-P0-09`, `FR-PLAN-005`). One code path for both goal
 * modes — the mode enters only through `hardConstraints` + `weights` (ADR-09).
 *
 * On an infeasible input the result is not a bare verdict: `diagnoseInfeasible` attaches
 * the cheapest valid plan, the ₴ delta, and the binding constraint (T2.5, `FR-PLAN-006`).
 * On a feasible one, `refinePlan` (T3.3) applies portion fit + seeded local search on top of
 * greedy's pick.
 */
export function generatePlan(input: SolverInput): SolverResult {
  const hf = hardFilter(input);
  const result = greedyPlan(hf.kept, input);
  return result.feasible ? refinePlan(result, hf.kept, input) : diagnoseInfeasible(input, hf);
}
