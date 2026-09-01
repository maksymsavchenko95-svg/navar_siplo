/**
 * Deterministic receipt → `ConsumptionModel` aggregation (`FR-HH-002`, roadmap T1.4).
 * Pure, dependency-free, no I/O — ADR-02: buy frequency, brand tally and the cheque
 * baseline are arithmetic the deterministic code owns, never the LLM. Tested directly
 * (`consumption.test.ts`), mirroring `apps/api/src/scripts/audit-util.ts`.
 */

import type { BrandAffinity, BuyFrequency, ConsumptionModel, RetailOrder } from "@navar/domain";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Monday-start ISO week key (`YYYY-Www`), computed in UTC. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO: Thursday of this week decides the year.
  const day = (t.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      (t.getTime() - firstThursday.getTime()) / WEEK_MS - ((firstThursday.getUTCDay() + 6) % 7) / 7,
    );
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median of per-ISO-week spend. Weeks with no orders are gaps, not zero-spend weeks. */
export function medianWeeklyCheque(orders: RetailOrder[]): number | null {
  const byWeek = new Map<string, number>();
  for (const o of orders) {
    const week = isoWeekKey(new Date(o.createdAt));
    byWeek.set(week, (byWeek.get(week) ?? 0) + o.total);
  }
  const m = median([...byWeek.values()]);
  return m === null ? null : Math.round(m * 100) / 100;
}

/** A quoted brand token — «Галичина», „Моршинська", "President". Returns null if none. */
export function extractBrand(productName: string): string | null {
  const m = productName.match(/[«„"']\s*([^«„"'»]{2,40}?)\s*[»"']/);
  return m ? m[1]!.trim() : null;
}

export function tallyBrands(orders: RetailOrder[]): BrandAffinity[] {
  // brand -> { total, byCategory: Map }
  const brands = new Map<string, { purchases: number; category: string | null }>();
  const categoryTotals = new Map<string, number>();

  for (const o of orders) {
    for (const l of dedupeLines(o.lines)) {
      if (l.quantity <= 0) continue;
      const brand = extractBrand(l.name);
      const category = categoryOf(l);
      if (category) categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + 1);
      if (!brand) continue;
      const cur = brands.get(brand);
      if (cur) cur.purchases += 1;
      else brands.set(brand, { purchases: 1, category });
    }
  }

  return [...brands.entries()]
    .map(([brand, v]) => ({
      brand,
      category: v.category,
      purchases: v.purchases,
      categoryShare: v.category
        ? Math.round((v.purchases / (categoryTotals.get(v.category) || v.purchases)) * 1000) / 1000
        : 0,
    }))
    .sort((a, b) => b.purchases - a.purchases);
}

/** No category signal on raw lines yet (comes from the ingredient dictionary later). */
function categoryOf(_line: { slug: string | null }): string | null {
  return null;
}

/** Sum duplicate `key` lines within one order (nets voids against buys). */
function dedupeLines(lines: RetailOrder["lines"]): RetailOrder["lines"] {
  const byKey = new Map<string, RetailOrder["lines"][number]>();
  for (const l of lines) {
    const cur = byKey.get(l.key);
    if (cur) {
      cur.quantity += l.quantity;
      cur.lineTotal = Math.round((cur.lineTotal + l.lineTotal) * 100) / 100;
    } else {
      byKey.set(l.key, { ...l });
    }
  }
  return [...byKey.values()];
}

export function buildConsumptionModel(orders: RetailOrder[], now: Date): ConsumptionModel {
  if (orders.length === 0) {
    return {
      source: "receipts",
      orderCount: 0,
      window: null,
      medianWeeklyChequeUah: null,
      buyFrequency: [],
      brandAffinity: [],
    };
  }

  const times = orders.map((o) => new Date(o.createdAt).getTime()).sort((a, b) => a - b);
  const windowStart = new Date(times[0]!);
  const windowEnd = new Date(times[times.length - 1]!);
  const windowDays = Math.max((now.getTime() - windowStart.getTime()) / DAY_MS, 28);

  // key -> aggregate across orders
  type Agg = {
    label: string;
    slug: string | null;
    unit: string | null;
    netQuantity: number;
    orders: number;
    lastMs: number;
  };
  const agg = new Map<string, Agg>();

  for (const o of orders) {
    const orderMs = new Date(o.createdAt).getTime();
    for (const l of dedupeLines(o.lines)) {
      const a = agg.get(l.key) ?? {
        label: l.name || l.key,
        slug: l.slug,
        unit: l.unit,
        netQuantity: 0,
        orders: 0,
        lastMs: 0,
      };
      a.netQuantity += l.quantity;
      if (l.quantity > 0) {
        a.orders += 1;
        a.lastMs = Math.max(a.lastMs, orderMs);
      }
      agg.set(l.key, a);
    }
  }

  const buyFrequency: BuyFrequency[] = [...agg.entries()]
    .filter(([, a]) => a.netQuantity > 0 && a.orders > 0)
    .map(([key, a]) => ({
      key,
      label: a.label,
      category: null,
      buysPer4Weeks: Math.round((a.orders / (windowDays / 28)) * 100) / 100,
      avgQuantity: Math.round((a.netQuantity / a.orders) * 1000) / 1000,
      unit: a.unit,
      lastBoughtDaysAgo:
        a.lastMs > 0 ? Math.max(0, Math.floor((now.getTime() - a.lastMs) / DAY_MS)) : null,
      orderShare: Math.round((a.orders / orders.length) * 1000) / 1000,
    }))
    .sort((x, y) => y.buysPer4Weeks - x.buysPer4Weeks || x.key.localeCompare(y.key));

  return {
    source: "receipts",
    orderCount: orders.length,
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    medianWeeklyChequeUah: medianWeeklyCheque(orders),
    buyFrequency,
    brandAffinity: tallyBrands(orders),
  };
}

/** Build the PII-free aggregate the `inferConsumption` LLM step consumes. */
export function toInferConsumptionInput(model: ConsumptionModel) {
  const weeks = model.window
    ? Math.max(
        1,
        Math.round(
          (new Date(model.window.end).getTime() - new Date(model.window.start).getTime()) / WEEK_MS,
        ),
      )
    : 0;
  return {
    orderCount: model.orderCount,
    weeks,
    topItems: model.buyFrequency.slice(0, 25).map((b) => ({
      label: b.label,
      buysPer4Weeks: b.buysPer4Weeks,
      category: b.category,
    })),
    topBrands: model.brandAffinity
      .slice(0, 15)
      .map((b) => ({ brand: b.brand, category: b.category })),
    medianWeeklyChequeUah: model.medianWeeklyChequeUah,
  };
}
