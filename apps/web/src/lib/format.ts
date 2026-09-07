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
