import type { RecipeCandidate, SolverInput } from "./contract.js";

export interface HardFilterResult {
  kept: RecipeCandidate[];
  droppedReasons: Map<string, string>; // recipeId → why
  /** Non-null when `maxActiveMinutes` had to be relaxed to reach `days * 3` candidates. */
  relaxedMinutesTo: number | null;
}

const MIN_CANDIDATES_PER_DAY = 3;
const RELAX_STEP_MIN = 15;
const RELAX_MAX_MIN = 60;
const UNMAPPED_TOLERANCE = 0.2; // >20% ingredients unmapped → drop (TDD §4 step 1)

/** Reasons a candidate fails the hard filter, or `null` if it passes at `maxMinutes`. */
function rejectReason(c: RecipeCandidate, input: SolverInput, maxMinutes: number): string | null {
  const excludedIds = new Set(input.hardConstraints.excludedIngredients);
  const nonOptional = c.ingredients.filter((l) => !l.optional);

  const hitExcluded = nonOptional.find((l) => excludedIds.has(l.id));
  if (hitExcluded) return `excluded ingredient ${hitExcluded.id}`;

  if (c.activeMinutes > maxMinutes) return `activeMinutes ${c.activeMinutes} > ${maxMinutes}`;

  // `form` hard filter: the per-dinner protein floor (TDD §4 step 1). The kcal corridor is
  // NOT a hard filter here — T3.3's portion fit is what lands a dish inside it; until then
  // `kcalRange` is carried for reporting only (`totals.kcalCorridorMet`).
  const { proteinMinPerDay } = input.hardConstraints;
  if (proteinMinPerDay != null && c.macrosPerServing.protein < proteinMinPerDay) {
    return `protein ${Math.round(c.macrosPerServing.protein)} < ${proteinMinPerDay}`;
  }

  if (nonOptional.length > 0) {
    const unmapped = nonOptional.filter((l) => !input.prices.has(l.id)).length;
    if (unmapped / nonOptional.length > UNMAPPED_TOLERANCE) {
      return `${unmapped}/${nonOptional.length} ingredients unmapped`;
    }
  }

  return null;
}

/**
 * HARD FILTER (TDD §4 step 1). Allergens are enforced upstream (the assembler drops recipes
 * whose `recipes.allergens` intersect the household's exclusions), so this pass covers
 * excluded ingredients, prep-time, the `form` kcal/protein corridor, and catalogue
 * coverage. If fewer than `days * 3` recipes survive, `maxActiveMinutes` is relaxed in
 * 15-min steps (up to +60) before giving up.
 */
export function hardFilter(input: SolverInput): HardFilterResult {
  const target = input.days * MIN_CANDIDATES_PER_DAY;
  const baseMax = input.hardConstraints.maxActiveMinutes;

  for (let extra = 0; extra <= RELAX_MAX_MIN; extra += RELAX_STEP_MIN) {
    const maxMinutes = baseMax + extra;
    const droppedReasons = new Map<string, string>();
    const kept: RecipeCandidate[] = [];
    for (const c of input.candidates) {
      const reason = rejectReason(c, input, maxMinutes);
      if (reason) droppedReasons.set(c.recipeId, reason);
      else kept.push(c);
    }
    if (kept.length >= target || extra === RELAX_MAX_MIN) {
      return { kept, droppedReasons, relaxedMinutesTo: extra === 0 ? null : maxMinutes };
    }
  }
  // unreachable — the loop always returns on its last iteration
  return { kept: [], droppedReasons: new Map(), relaxedMinutesTo: baseMax + RELAX_MAX_MIN };
}
