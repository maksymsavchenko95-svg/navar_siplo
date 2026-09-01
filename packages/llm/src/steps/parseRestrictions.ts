import {
  type ParseRestrictionsInput,
  type ParseRestrictionsOutput,
  type ParsedRestriction,
  parseRestrictionsOutputSchema,
} from "@navar/domain";

import { loadPrompt } from "../prompt.js";
import { defineStep } from "../step.js";

const PROMPT = loadPrompt("parseRestrictions", 1);

/**
 * `parseRestrictions` (TDD §6, `ASM-04`) — free-text restrictions → dictionary codes.
 * The LLM only interprets; the deterministic fallback is direct keyword→code matching,
 * recall-oriented for allergens (safety-critical).
 */

interface DictEntry {
  re: RegExp;
  kind: ParsedRestriction["kind"];
  code: string;
  severity: ParsedRestriction["severity"];
}

/** Keyword → code table (UA / RU / EN). Order matters — first match wins per phrase. */
const RESTRICTION_DICTIONARY: DictEntry[] = [
  {
    re: /безглютен|без глютен|глютен|клейковин|gluten[- ]?free|gluten/i,
    kind: "diet",
    code: "gluten_free",
    severity: "strict",
  },
  {
    re: /безлактозн|без лактоз|лактоз|lactose[- ]?free|lactose/i,
    kind: "diet",
    code: "lactose_free",
    severity: "strict",
  },
  { re: /арахіс|арахис|peanut/i, kind: "allergen", code: "peanuts", severity: "strict" },
  {
    re: /горіх|горех|орех|tree[- ]?nut|\bnuts?\b/i,
    kind: "allergen",
    code: "tree_nuts",
    severity: "strict",
  },
  { re: /кунжут|сезам|sesame/i, kind: "allergen", code: "sesame", severity: "strict" },
  {
    re: /морепродукт|креветк|краб|shrimp|crab|crustacean/i,
    kind: "allergen",
    code: "crustaceans",
    severity: "strict",
  },
  { re: /міді|молюск|mussel|mollus[ck]/i, kind: "allergen", code: "molluscs", severity: "strict" },
  { re: /\bриб[аиуоеі]|рибн|\bfish\b/i, kind: "allergen", code: "fish", severity: "strict" },
  { re: /яйц|яиц|\begg/i, kind: "allergen", code: "egg", severity: "strict" },
  { re: /соєв|\bсоя\b|\bсои\b|\bsoy/i, kind: "allergen", code: "soybeans", severity: "strict" },
  { re: /селера|сельдере|celery/i, kind: "allergen", code: "celery", severity: "strict" },
  { re: /гірчиц|горчиц|mustard/i, kind: "allergen", code: "mustard", severity: "strict" },
  { re: /сульфіт|сульфит|sulph?ite/i, kind: "allergen", code: "sulphites", severity: "strict" },
  {
    re: /молочн|молоко|молочка|\bmilk\b|\bdairy\b/i,
    kind: "allergen",
    code: "milk",
    severity: "strict",
  },
  { re: /веган|vegan/i, kind: "diet", code: "vegan", severity: "strict" },
  { re: /вегетаріан|вегетариан|vegetarian/i, kind: "diet", code: "vegetarian", severity: "strict" },
  { re: /пескетаріан|pescatarian/i, kind: "diet", code: "pescatarian", severity: "strict" },
  { re: /халяль|халал|halal/i, kind: "diet", code: "halal", severity: "strict" },
  { re: /кошер|kosher/i, kind: "diet", code: "kosher", severity: "strict" },
  { re: /свинин|свинян|\bpork\b/i, kind: "diet", code: "no_pork", severity: "strict" },
  { re: /яловичин|говядин|\bbeef\b/i, kind: "diet", code: "no_beef", severity: "strict" },
  {
    re: /без цукру|без сахара|no sugar|sugar[- ]?free/i,
    kind: "diet",
    code: "no_sugar",
    severity: "soft",
  },
  { re: /гриб|mushroom/i, kind: "dislike", code: "mushroom", severity: "soft" },
  {
    re: /кінз|кинз|коріандр|кориандр|cilantro|coriander/i,
    kind: "dislike",
    code: "cilantro",
    severity: "soft",
  },
];

export function matchDictionary(phrase: string): ParsedRestriction[] {
  const hits: ParsedRestriction[] = [];
  const seen = new Set<string>();
  for (const e of RESTRICTION_DICTIONARY) {
    if (!e.re.test(phrase)) continue;
    const dedupe = `${e.kind}:${e.code}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    hits.push({ kind: e.kind, code: e.code, severity: e.severity, sourceText: phrase });
  }
  return hits;
}

export const parseRestrictionsStep = defineStep<ParseRestrictionsInput, ParseRestrictionsOutput>({
  name: "parseRestrictions",
  promptVersion: PROMPT.version,
  schema: parseRestrictionsOutputSchema,
  build: (input) => ({ system: PROMPT.text, prompt: JSON.stringify(input) }),
  fallback: (input) => ({ restrictions: input.phrases.flatMap(matchDictionary) }),
});
