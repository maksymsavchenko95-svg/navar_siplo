import { convert, type ConsolidatedIngredient, type Unit } from "@navar/domain";

import type { MapperDictEntry, PlanIngredientLine } from "./types.js";

/**
 * Consolidation failed fail-closed (`FR-MAP-001`, ADR-02): an unknown ingredient slug, or a
 * unit that can't be converted to the ingredient's base unit without guessing.
 */
export class ConsolidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsolidationError";
  }
}

/**
 * One recipe line → an amount in the ingredient's base unit. Generalises
 * `@navar/db` `gramsForLine` to any base unit and fails closed exactly like `convert`
 * (no density → throw, `pcs` ↔ mass without `gramsPerPiece` → throw).
 */
export function toBaseAmount(entry: MapperDictEntry, amount: number, unit: Unit): number {
  const density = entry.densityGMl ?? undefined;

  if (unit === entry.baseUnit) return amount;

  // pcs on either side needs a grams-per-piece bridge.
  if (unit === "pcs" || entry.baseUnit === "pcs") {
    if (entry.gramsPerPiece == null) {
      throw new ConsolidationError(
        `${entry.slug}: cannot convert ${amount} ${unit} to ${entry.baseUnit} without gramsPerPiece`,
      );
    }
    if (unit === "pcs") {
      // pcs → grams, then grams → the (mass/volume) base unit.
      const grams = amount * entry.gramsPerPiece;
      return entry.baseUnit === "g" ? grams : safeConvert(entry, grams, "g", entry.baseUnit);
    }
    // (g|kg) → grams → pieces.
    const grams = safeConvert(entry, amount, unit, "g");
    return grams / entry.gramsPerPiece;
  }

  return safeConvert(entry, amount, unit, entry.baseUnit, density);
}

function safeConvert(
  entry: MapperDictEntry,
  amount: number,
  from: Unit,
  to: Unit,
  density?: number,
): number {
  try {
    return convert(amount, from, to, density ?? entry.densityGMl ?? undefined);
  } catch (err) {
    throw new ConsolidationError(
      `${entry.slug}: cannot convert ${amount} ${from} → ${to} — ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/**
 * Sum identical `CanonicalIngredient`s across the plan's lines, each in its base unit.
 * Output is sorted by slug so the whole pipeline is order-independent (ADR-03). A line
 * whose slug is missing from `dict` aborts — a plan must not reference unknown ingredients.
 */
export function consolidate(
  lines: readonly PlanIngredientLine[],
  dict: ReadonlyMap<string, MapperDictEntry>,
): ConsolidatedIngredient[] {
  const acc = new Map<
    string,
    { entry: MapperDictEntry; amount: number; lineCount: number; requiredLines: number }
  >();

  for (const line of lines) {
    const entry = dict.get(line.slug);
    if (!entry) throw new ConsolidationError(`unknown ingredient slug: ${line.slug}`);
    const add = toBaseAmount(entry, line.amount, line.unit);
    const cur = acc.get(line.slug) ?? { entry, amount: 0, lineCount: 0, requiredLines: 0 };
    cur.amount += add;
    cur.lineCount += 1;
    if (!line.optional) cur.requiredLines += 1;
    acc.set(line.slug, cur);
  }

  return [...acc.values()]
    .map(({ entry, amount, lineCount, requiredLines }) => ({
      slug: entry.slug,
      nameUk: entry.nameUk,
      category: entry.category,
      baseUnit: entry.baseUnit,
      amount: round(amount),
      lineCount,
      optionalOnly: requiredLines === 0,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Guard against float dust so the determinism tests deep-equal cleanly. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
