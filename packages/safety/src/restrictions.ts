import { type Allergen, allergenSchema, type StoredRestriction } from "@navar/domain";

/**
 * The hard exclusions a household's restrictions resolve to. Feeds both the mapper's
 * ingredient-level gate and (T2.3) `SolverInput.hardConstraints`.
 */
export interface Exclusions {
  /** EU-14 allergen codes — never planned, never added to the cart. */
  allergens: Allergen[];
  /** Canonical ingredient slugs to exclude (strict dislikes). */
  ingredients: string[];
  /** `FR-SAFE-007` strict mode — only SKUs with a confirmed full composition pass. Default off. */
  strictMode: boolean;
}

/** Diet codes that imply an allergen exclusion (the gate bridges these; other diets are T2.3). */
const DIET_TO_ALLERGENS: Record<string, Allergen[]> = {
  gluten_free: ["gluten"],
  lactose_free: ["milk"],
  dairy_free: ["milk"],
};

/**
 * Last-resort remap for a `kind:"allergen"` code that is not a valid EU-14 `allergenSchema`
 * value (a stale row, or an LLM result that slipped through before the schema was
 * tightened). A missed allergy is catastrophic (`.claude/rules/food-safety.md`), so we do
 * not drop these silently — remap the unambiguous ones, and `console.warn` either way
 * (`FR-SAFE-006`).
 */
const ALLERGEN_CODE_SYNONYMS: [RegExp, Allergen][] = [
  [/lact|dairy|milk|молок|молоч|сливк/i, "milk"],
  [/glut|wheat|пшениц|клейковин|глютен/i, "gluten"],
  [/\begg|яйц|яєц/i, "egg"],
  [/soy|соя|соєв/i, "soybeans"],
  [/peanut|арахіс|арахис/i, "peanuts"],
  [/tree.?nut|горіх|горех|орех/i, "tree_nuts"],
  [/sesame|кунжут|сезам/i, "sesame"],
  [/fish|риб/i, "fish"],
];

function remapAllergenCode(code: string): Allergen | null {
  for (const [re, allergen] of ALLERGEN_CODE_SYNONYMS) if (re.test(code)) return allergen;
  return null;
}

/**
 * `StoredRestriction[]` → hard exclusions (deterministic, ADR-02). Scope (T2.2 decision):
 * `kind:"allergen"` + the allergen-equivalent `kind:"diet"` codes + strict `kind:"dislike"`.
 * `vegan` / `vegetarian` / `halal` / `no_pork` … are recipe-tag filters for T2.3, not this gate.
 */
export function resolveExclusions(
  restrictions: readonly StoredRestriction[],
  opts: { strictMode?: boolean } = {},
): Exclusions {
  const allergens = new Set<Allergen>();
  const ingredients = new Set<string>();

  for (const r of restrictions) {
    if (r.kind === "allergen") {
      const parsed = allergenSchema.safeParse(r.code);
      if (parsed.success) {
        allergens.add(parsed.data);
        continue;
      }
      const remapped = remapAllergenCode(r.code);
      if (remapped) {
        console.warn(
          `[safety] non-canonical allergen code ${JSON.stringify(r.code)} → ${remapped} (FR-SAFE-006)`,
        );
        allergens.add(remapped);
      } else {
        console.warn(
          `[safety] unrecognized allergen code ${JSON.stringify(r.code)} — declared allergy not enforced; needs review (FR-SAFE-006)`,
        );
      }
      continue;
    }
    if (r.kind === "diet") {
      for (const a of DIET_TO_ALLERGENS[r.code] ?? []) allergens.add(a);
      continue;
    }
    if (r.kind === "dislike" && r.severity === "strict" && !r.code.startsWith("name:")) {
      ingredients.add(r.code);
    }
  }

  return {
    allergens: [...allergens].sort(),
    ingredients: [...ingredients].sort(),
    strictMode: opts.strictMode ?? false,
  };
}

/** Convenience: does this household declare anything the safety gate hard-blocks? */
export function hasHardExclusion(x: Exclusions): boolean {
  return x.allergens.length > 0 || x.ingredients.length > 0;
}
