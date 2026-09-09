/**
 * Guest-facing number formatting. Pure + deterministic (no `Intl` locale dependence) so the
 * unit tests are stable across environments. Ukrainian convention: a narrow no-break space
 * groups thousands, `₴` trails after a no-break space.
 */

export const THIN_SPACE = " "; // narrow no-break space — groups thousands
export const NBSP = " "; // no-break space — before the currency sign
export const MINUS = "−"; // real minus sign

/** Group the integer part of `n` with narrow no-break spaces. Keeps a non-zero fraction. */
export function groupNumber(n: number, maxFractionDigits = 0): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(maxFractionDigits);
  const [intPart, fracPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  const body = fracPart && Number(fracPart) !== 0 ? `${grouped},${fracPart}` : grouped;
  return neg ? `${MINUS}${body}` : body;
}

/** `2 340 ₴` — rounds to whole hryvnia by default. `null`/`undefined` → `—`. */
export function uah(n: number | null | undefined, fractionDigits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${groupNumber(n, fractionDigits)}${NBSP}₴`;
}

/** Signed hryvnia delta: `+180 ₴` / `−240 ₴` / `без змін`. */
export function signedUah(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "без змін";
  const sign = n > 0 ? "+" : "";
  return `${sign}${uah(n)}`;
}

/** `37 %` — expects a 0–100 percentage, rounds to a whole number. */
export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}${NBSP}%`;
}

/** `45 хв` cook time. */
export function minutes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}${NBSP}хв`;
}

/** `≈ 2 340 ₴` — estimate marker for a formatted string. */
export function approx(s: string): string {
  return `≈${NBSP}${s}`;
}

const MONTHS_UK_GENITIVE = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

/** `1 особу` / `2 особи` / `5 осіб` — Ukrainian count of people (nominative-object form). */
export function pluralPeople(n: number): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = Math.abs(n) % 10;
  let word: string;
  if (mod100 >= 11 && mod100 <= 14) word = "осіб";
  else if (mod10 === 1) word = "особу";
  else if (mod10 >= 2 && mod10 <= 4) word = "особи";
  else word = "осіб";
  return `${n} ${word}`;
}

const UNIT_LABEL_UK: Record<string, string> = { g: "г", ml: "мл", pcs: "шт", kg: "кг", l: "л" };

/** Recipe-ingredient unit → Ukrainian short label. Unknown units pass through unchanged. */
export function unitLabel(unit: string): string {
  return UNIT_LABEL_UK[unit] ?? unit;
}

/**
 * A shopping-list line's buy quantity for display: «0.3 кг» for a weighted line (MCP
 * `1.109.8` — the cart quantity is kilograms), «2 уп.» for packaged goods. Accepts either
 * a preview line (`quantity`) or a SKU alternative (`packCount`).
 */
export function quantityLabel(l: {
  quantity?: number;
  packCount?: number;
  quantityKg?: number | null;
}): string {
  if (l.quantityKg != null) return `${l.quantityKg} кг`;
  return `${l.quantity ?? l.packCount ?? 0} уп.`;
}

/**
 * `8 вересня, 14:32` — a plan's creation moment, local time. Deterministic month names
 * (no `Intl`), so duplicate plans a minute apart stay distinguishable on `/plans`.
 */
export function planTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS_UK_GENITIVE[d.getMonth()]}, ${hh}:${mm}`;
}
