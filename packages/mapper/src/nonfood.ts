import { normalizeText } from "@navar/domain";

/**
 * SKU-name stems that mean a search hit is not a foodstuff (R7). A trigram search for a
 * short ingredient name occasionally returns a decoration / homeware / pet item whose name
 * coincidentally overlaps (the canonical case: «зіра» → «Бант … Зірка»). Filtered out
 * before scoring so it never becomes a match; an emptied candidate list falls through to
 * `sku_unknown` (§0). Kept tight — every stem must be impossible in a real food name.
 */
const NON_FOOD_SKU_STEMS: readonly string[] = [
  "бант",
  "оздобленн", // «для оздоблення подарунку»
  "гірлянд",
  "листівк",
  "іграшк",
  "серветк",
  "посуд",
  "сервіз",
  "батарейк",
  "лампочк",
  "наповнювач для", // cat litter
  "корм для", // pet food
  "засіб для", // cleaning agent
];

/** True when a Silpo SKU name is clearly not food (decoration, homeware, pet, chemicals). */
export function isNonFoodSku(name: string): boolean {
  const n = normalizeText(name);
  return NON_FOOD_SKU_STEMS.some((s) => n.includes(s));
}
