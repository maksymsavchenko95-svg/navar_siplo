import type { SolverInput, SolverResult } from "./contract.js";
import { hardFilter } from "./filter.js";
import { greedyPlan } from "./greedy.js";

/**
 * The deterministic meal-plan solver (TDD §4 steps 1–4). Same `SolverInput` + same `seed`
 * → byte-identical `SolverResult` (`AC-P0-09`, `FR-PLAN-005`). One code path for both goal
 * modes — the mode enters only through `hardConstraints` + `weights` (ADR-09).
 *
 * Steps 5–6 (portion fit, local search) are T3.3; the rich infeasible delta+reason is T2.5.
 */
export function generatePlan(input: SolverInput): SolverResult {
  const { kept } = hardFilter(input);
  // TODO(T3.3): portion fit + seeded local search over the greedy result.
  return greedyPlan(kept, input);
}
