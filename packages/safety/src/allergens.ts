import { type Allergen, allergenSchema } from "@navar/domain";

/**
 * Silpo declares allergens as ALLCAPS tokens in the `Містить алергени` attribute
 * (comma-separated) and inline in `Склад` — `"ГЛЮТЕН"`, `"ПШЕНИЦЯ"`, `"МОЛОКО"`. This maps
 * those raw UA (+ RU / EN) tokens onto the EU-14 `allergenSchema` codes.
 *
 * Recall-oriented on purpose (`.claude/rules/food-safety.md`): a false positive blocks an
 * item the Guest could have had; a false negative is catastrophic. Tokens we cannot
 * classify are returned in `unknown` — next to a declared allergy they are fail-closed
 * material (`checkSku`), not a silent pass.
 */

/** Uppercase, fold `ё→е`, keep only letters + digits (drops spaces, punctuation, `«»`). */
export function normalizeAllergenToken(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/Ё/g, "Е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Stem → code. Matched as a substring of the normalised token (`ПШЕНИЧНУ` ⊇ `ПШЕНИЧ`). */
const STEMS: readonly (readonly [string, Allergen])[] = [
  // gluten-bearing cereals
  ["ГЛЮТЕН", "gluten"],
  ["ГЛЮТ", "gluten"],
  ["КЛЕЙКОВИН", "gluten"],
  ["ПШЕНИЦ", "gluten"],
  ["ПШЕНИЧ", "gluten"],
  ["ЖИТ", "gluten"], // ЖИТО / ЖИТНЄ / ЖИТНІЙ
  ["РОЖ", "gluten"], // рожь (ru)
  ["ЯЧМІН", "gluten"],
  ["ЯЧМЕН", "gluten"],
  ["ОВЕС", "gluten"],
  ["ОВЯН", "gluten"], // вівсяний / овсяный
  ["ОВСЯН", "gluten"],
  ["СПЕЛЬТ", "gluten"],
  ["КАМУТ", "gluten"],
  ["СОЛОД", "gluten"], // солод (malt)
  // milk
  ["МОЛОК", "milk"],
  ["МОЛОЧ", "milk"],
  ["ЛАКТОЗ", "milk"],
  ["ВЕРШК", "milk"],
  ["СЛИВК", "milk"], // сливки (ru)
  ["СИРОВАТ", "milk"], // сироватка / whey
  ["СИВОРОТ", "milk"],
  ["КАЗЕЇН", "milk"],
  ["КАЗЕИН", "milk"],
  // egg
  ["ЯЙЦ", "egg"],
  ["ЯЄЦЬ", "egg"],
  ["ЯЄЧН", "egg"],
  ["ЯИЦ", "egg"],
  ["ЯИЧН", "egg"],
  ["АЛЬБУМІН", "egg"],
  // fish
  ["РИБ", "fish"],
  ["FISH", "fish"],
  // peanuts
  ["АРАХІС", "peanuts"],
  ["АРАХИС", "peanuts"],
  ["PEANUT", "peanuts"],
  // tree nuts
  ["ГОРІХ", "tree_nuts"],
  ["ГОРЕХ", "tree_nuts"],
  ["ОРЕХ", "tree_nuts"],
  ["МИГДАЛ", "tree_nuts"],
  ["МІНДАЛ", "tree_nuts"],
  ["ФУНДУК", "tree_nuts"],
  ["ЛІЩИН", "tree_nuts"],
  ["КЕШ", "tree_nuts"], // кешʼю
  ["ПЕКАН", "tree_nuts"],
  ["ФІСТАШ", "tree_nuts"],
  ["ФИСТАШ", "tree_nuts"],
  ["МАКАДАМ", "tree_nuts"],
  ["ВОЛОСЬК", "tree_nuts"],
  ["БРАЗИЛЬСЬК", "tree_nuts"],
  // soybeans
  ["СОЯ", "soybeans"],
  ["СОЄ", "soybeans"],
  ["СОЇ", "soybeans"],
  ["СОИ", "soybeans"],
  ["SOY", "soybeans"],
  // celery
  ["СЕЛЕР", "celery"],
  ["СЕЛЬДЕРЕ", "celery"],
  // mustard
  ["ГІРЧИЦ", "mustard"],
  ["ГОРЧИЦ", "mustard"],
  ["MUSTARD", "mustard"],
  // sesame
  ["КУНЖУТ", "sesame"],
  ["СЕЗАМ", "sesame"],
  ["SESAME", "sesame"],
  // sulphites
  ["СУЛЬФІТ", "sulphites"],
  ["СУЛЬФИТ", "sulphites"],
  ["ДІОКСИДСІРК", "sulphites"],
  ["СІРЧИСТ", "sulphites"],
  ["SO2", "sulphites"],
  ["Е220", "sulphites"],
  ["Е221", "sulphites"],
  ["Е222", "sulphites"],
  ["Е223", "sulphites"],
  ["Е224", "sulphites"],
  ["Е228", "sulphites"],
  // lupin
  ["ЛЮПИН", "lupin"],
  ["ЛЮПІН", "lupin"],
  ["ВОВЧИЙБІБ", "lupin"],
  // molluscs
  ["МОЛЮСК", "molluscs"],
  ["МІДІ", "molluscs"],
  ["УСТРИЦ", "molluscs"],
  ["КАЛЬМАР", "molluscs"],
  ["РАПАН", "molluscs"],
  // crustaceans
  ["РАКОПОДІБ", "crustaceans"],
  ["РАКООБРАЗ", "crustaceans"],
  ["КРЕВЕТ", "crustaceans"],
  ["КРАБ", "crustaceans"],
  ["ОМАР", "crustaceans"],
  ["ЛАНГУСТ", "crustaceans"],
];

/** Substring-match a single normalised token against every stem. */
function stemsFor(norm: string): Allergen[] {
  const out: Allergen[] = [];
  for (const [stem, code] of STEMS) if (norm.includes(stem)) out.push(code);
  return out;
}

/**
 * Recall-oriented scan of a SKU's `Склад` free-text for EU-14 allergens (`FR-SAFE-002`,
 * ADR-05). Silpo's structured `Містить алергени` attribute is present on a minority of
 * cards (M0 audit) and is often thinner than the composition itself, so `checkSku` unions
 * these hits with the structured ones before the exclusion check. Split on non-alphanumeric
 * runs, normalise each word, substring-match the `STEMS` table. Unlike `mapSkuAllergens`
 * this returns **no `unknown`** — an ordinary ingredient list is not an ambiguity signal,
 * only a positive-match signal (feeding it into `ambiguous` would fail-close every SKU that
 * ships a composition).
 */
export function scanCompositionText(text: string): { codes: Allergen[] } {
  const codes = new Set<Allergen>();
  for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
    const norm = normalizeAllergenToken(word);
    if (norm.length < 3) continue;
    for (const code of stemsFor(norm)) codes.add(code);
  }
  return {
    codes: [...codes].filter((c) => allergenSchema.safeParse(c).success).sort(),
  };
}

/**
 * Map raw Silpo allergen tokens → EU-14 codes. `codes` is sorted + deduped; `unknown`
 * holds normalised tokens that matched nothing.
 */
export function mapSkuAllergens(raw: readonly string[]): { codes: Allergen[]; unknown: string[] } {
  const codes = new Set<Allergen>();
  const unknown = new Set<string>();
  for (const token of raw) {
    const norm = normalizeAllergenToken(token);
    if (norm.length < 2) continue;
    let matched = false;
    for (const [stem, code] of STEMS) {
      if (norm.includes(stem)) {
        codes.add(code);
        matched = true;
      }
    }
    if (!matched) unknown.add(norm);
  }
  return {
    codes: [...codes].filter((c) => allergenSchema.safeParse(c).success).sort(),
    unknown: [...unknown].sort(),
  };
}
