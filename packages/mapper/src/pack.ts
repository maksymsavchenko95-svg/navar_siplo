import type { BaseUnit } from "@navar/domain";

const UNIT_TO_BASE: Record<string, { base: BaseUnit; factor: number }> = {
  г: { base: "g", factor: 1 },
  гр: { base: "g", factor: 1 },
  грам: { base: "g", factor: 1 },
  кг: { base: "g", factor: 1000 },
  мл: { base: "ml", factor: 1 },
  л: { base: "ml", factor: 1000 },
  шт: { base: "pcs", factor: 1 },
};

/**
 * Parse a Silpo `displayRatio` pack string (`"800г"`, `"0,85л"`, `"10 шт"`, `"2х100г"`)
 * into an amount in `baseUnit`, or `null` when it can't be related to the base unit or is a
 * price-per label (`"за 100 г"`). Deterministic and total.
 */
export function parsePackSize(raw: string | null, baseUnit: BaseUnit): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/,/g, ".").trim();
  if (s.startsWith("за")) return null; // "за 100 г" — a unit price, not a pack

  const multi = s.match(/(\d+(?:\.\d+)?)\s*[хx*]\s*(\d+(?:\.\d+)?)\s*(грам|гр|г|мл|кг|л|шт)/);
  const single = s.match(/(\d+(?:\.\d+)?)\s*(грам|гр|г|мл|кг|л|шт)/);

  let amount: number;
  let unit: string;
  if (multi) {
    amount = Number(multi[1]) * Number(multi[2]);
    unit = multi[3]!;
  } else if (single) {
    amount = Number(single[1]);
    unit = single[2]!;
  } else {
    return null;
  }

  const spec = UNIT_TO_BASE[unit];
  if (!spec || spec.base !== baseUnit) return null;
  const value = amount * spec.factor;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface PackPlan {
  packCount: number; // whole packs / weighings to buy
  boughtAmount: number; // total acquired, base unit
  surplusAmount: number; // boughtAmount − needed, base unit → future pantry
  packSize: number | null; // parsed pack size (base unit); null when unknown
  weighted: boolean; // priced by weight — `quantity` sent to the cart is kilograms
  /**
   * Kilograms to send to the Silpo cart, non-null only when `weighted` (MCP `1.109.8`:
   * for weighted goods the cart `quantity` and `step` are ALWAYS kg, `price` is ₴/kg).
   * Packaged goods buy whole units → `null`, the cart gets `packCount`.
   */
  quantityKg: number | null;
}

/**
 * Smallest sufficient purchase for `neededBase` (`FR-MAP-003`). Weighed goods buy the exact
 * mass (rounded up to the weighing `step`); packaged goods buy whole packs; an unknown pack
 * falls back to "buy exactly what's needed" with no surplus.
 */
export function computePack(
  neededBase: number,
  packSize: number | null,
  opts: { weighted?: boolean; step?: number | null } = {},
): PackPlan {
  const needed = Math.max(0, neededBase);

  if (opts.weighted) {
    const stepGrams = opts.step && opts.step > 0 ? opts.step * 1000 : null;
    const bought = stepGrams ? Math.ceil(needed / stepGrams) * stepGrams : needed;
    return {
      // The count of weighing steps, kept for display («3 × 100 г»); the cart write and
      // pricing use `quantityKg`, not this.
      packCount: stepGrams ? Math.round(bought / stepGrams) : 1,
      boughtAmount: round(bought),
      surplusAmount: round(Math.max(0, bought - needed)),
      packSize: stepGrams,
      weighted: true,
      quantityKg: round(bought / 1000),
    };
  }

  if (packSize == null || packSize <= 0) {
    return {
      packCount: 1,
      boughtAmount: round(needed),
      surplusAmount: 0,
      packSize: null,
      weighted: false,
      quantityKg: null,
    };
  }

  const packCount = Math.max(1, Math.ceil(needed / packSize));
  const bought = packCount * packSize;
  return {
    packCount,
    boughtAmount: round(bought),
    surplusAmount: round(Math.max(0, bought - needed)),
    packSize,
    weighted: false,
    quantityKg: null,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
