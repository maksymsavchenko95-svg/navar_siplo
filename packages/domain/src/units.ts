/**
 * Unit conversion — deterministic, never the LLM (ADR-02). Mass ↔ volume needs the
 * ingredient's density; count units (`pcs`) never convert. This is where a large share
 * of the product's bugs live (Brief §7), so it is small, pure, and tested.
 */

export type BaseUnit = "g" | "ml" | "pcs";
export type Unit = BaseUnit | "kg" | "l";

const TO_BASE: Record<Unit, { base: BaseUnit; factor: number }> = {
  g: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  l: { base: "ml", factor: 1000 },
  pcs: { base: "pcs", factor: 1 },
};

export class UnitConversionError extends Error {}

function spec(unit: Unit): { base: BaseUnit; factor: number } {
  const s = TO_BASE[unit];
  if (!s) throw new UnitConversionError(`Unknown unit: ${unit}`);
  return s;
}

/** Normalise `(amount, unit)` to a base unit (`g` | `ml` | `pcs`). */
export function toBaseUnit(amount: number, unit: Unit): { amount: number; unit: BaseUnit } {
  const s = spec(unit);
  return { amount: amount * s.factor, unit: s.base };
}

/**
 * Convert `amount` from one unit to another. Mass ↔ volume requires `densityGPerMl`
 * (grams per millilitre). Throws rather than guessing (fail-closed).
 */
export function convert(amount: number, from: Unit, to: Unit, densityGPerMl?: number): number {
  const f = spec(from);
  const t = spec(to);
  const baseAmount = amount * f.factor;

  let targetBase: number;
  if (f.base === t.base) {
    targetBase = baseAmount;
  } else if (f.base === "pcs" || t.base === "pcs") {
    throw new UnitConversionError(`Cannot convert between ${from} and ${to} (count unit)`);
  } else if (densityGPerMl === undefined || densityGPerMl <= 0) {
    throw new UnitConversionError(`Mass ↔ volume conversion (${from} → ${to}) needs a density`);
  } else {
    const grams = f.base === "g" ? baseAmount : baseAmount * densityGPerMl;
    targetBase = t.base === "g" ? grams : grams / densityGPerMl;
  }

  return targetBase / t.factor;
}
