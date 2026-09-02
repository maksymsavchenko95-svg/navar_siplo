import { normalizeText } from "@navar/domain";

import { BATCH_SIZE, type MapperDictEntry } from "./types.js";

/**
 * Bare unit / measure words — stripped by **exact token match** only (single letters like
 * `г` / `л` must not prefix-match real words such as `гречка`).
 */
const UNIT_WORDS: ReadonlySet<string> = new Set([
  "г",
  "гр",
  "грам",
  "грамів",
  "кг",
  "мл",
  "л",
  "літр",
  "шт",
  "штук",
  "штуки",
  "уп",
  "пак",
]);

/**
 * Modifier stems that sink `silpo_find_products_batch` (M0 audit follow-up #1): packaging
 * words and product-state adjectives. Matched as **prefixes** (Ukrainian case endings), so
 * every stem here is ≥ 4 chars.
 */
export const MODIFIER_STOPWORDS: readonly string[] = [
  // packaging / portion
  "пучок",
  "пучечок",
  "головк",
  "зубчик",
  "гілочк",
  "стебло",
  "пляшк",
  "пакет",
  "упаковк",
  // state / grade
  "охолоджен",
  "свіж",
  "заморожен",
  "добірн",
  "ваговий",
  "вагова",
  "вагове",
  "фасован",
  "натуральн",
  "домашн",
  "класичн",
  "столов",
  "питн",
  "мелен",
  "мелений",
  "молот",
  "подрібнен",
  "нарізан",
  "очищен",
  "сушен",
  "вялен",
  "копчен",
  "великий",
  "молодий",
];

function isNoiseToken(token: string): boolean {
  if (token.length < 2) return true;
  if (UNIT_WORDS.has(token)) return true;
  return MODIFIER_STOPWORDS.some((stem) => token === stem || token.startsWith(stem));
}

/** Content tokens of a phrase — normalised, noise words (units, modifiers, digits) removed. */
function contentTokens(phrase: string): string[] {
  return normalizeText(phrase)
    .split(" ")
    .filter((t) => !isNoiseToken(t));
}

/**
 * One clean search query for an ingredient: the canonical head noun with modifiers, units
 * and digits stripped. Prefers the normalised `nameUk` when it reduces to 1–3 content
 * tokens (that is the curated head-noun form); otherwise takes the shortest usable synonym;
 * falls back to the raw normalised `nameUk`.
 */
export function buildQuery(entry: MapperDictEntry): string {
  const fromName = contentTokens(entry.nameUk);
  if (fromName.length >= 1 && fromName.length <= 3) return fromName.join(" ");

  const synonymPhrases = entry.synonyms
    .map(contentTokens)
    .filter((toks) => toks.length >= 1)
    .map((toks) => toks.join(" "))
    .sort((a, b) => a.split(" ").length - b.split(" ").length || a.length - b.length);

  return synonymPhrases[0] ?? normalizeText(entry.nameUk);
}

/** Split a query list into `find_products_batch`-sized chunks (`FR-MAP-004`). */
export function chunkQueries(queries: readonly string[], size = BATCH_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < queries.length; i += size) out.push(queries.slice(i, i + size));
  return out;
}
