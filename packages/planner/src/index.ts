/**
 * @navar/planner — the deterministic meal-plan solver (TDD v0.2 §4, SRS §6.5, ADR-02/03/09).
 * Greedy day-by-day over a hard-filtered recipe corpus, maximising the `WEIGHTS[goal]` soft
 * profile; cost is computed in pack sizes, not grams. Same inputs + same seed → same plan.
 * Only dish generation / re-ranking / explanations touch the LLM.
 */

export {
  WEIGHTS,
  type SolverWeights,
  type SolverGoalConstraints,
  type RecipeIngredientLine,
  type RecipeCandidate,
  type SolverInput,
  type PlanDayPick,
  type PlanTotals,
  type SolverResult,
  type InfeasibleBinding,
} from "./contract.js";
export { generatePlan } from "./generate.js";
export { hardFilter, type HardFilterResult } from "./filter.js";
export { recipeCost, type RecipeCost } from "./cost.js";
export { scoreRecipe, type SolverState, type ScoreBreakdown } from "./score.js";
export { greedyPlan, planTotals } from "./greedy.js";
export { cheapestPlan, diagnoseInfeasible } from "./nearest.js";
export { mulberry32, shuffle, type Rng } from "./rng.js";
export {
  bestPortionScale,
  type DayAlternative,
  dayAlternatives,
  localSearch,
  portionFit,
  refinePlan,
  replay,
  safePortionRange,
  satisfiesProteinFloor,
  scalePortionMacros,
  type ReplayResult,
} from "./refine.js";
