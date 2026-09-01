import type { RetailOrder } from "@navar/domain";
import { describe, expect, it } from "vitest";

import {
  buildConsumptionModel,
  extractBrand,
  isoWeekKey,
  medianWeeklyCheque,
  tallyBrands,
} from "./consumption.js";

const NOW = new Date("2026-09-02T00:00:00Z");

function order(createdAt: string, total: number, lines: RetailOrder["lines"] = []): RetailOrder {
  return { source: "offline", externalId: createdAt, createdAt, total, discount: 0, lines };
}
function line(key: string, name: string, qty: number, price = 10): RetailOrder["lines"][number] {
  return {
    key,
    name,
    slug: key.includes(":") ? null : key,
    unitPrice: price,
    quantity: qty,
    lineTotal: Math.round(price * qty * 100) / 100,
    unit: null,
    catalogProductId: null,
  };
}

describe("isoWeekKey", () => {
  it("is Monday-start and stable", () => {
    expect(isoWeekKey(new Date("2026-09-02T12:00:00Z"))).toBe(
      isoWeekKey(new Date("2026-08-31T00:00:00Z")),
    );
    expect(isoWeekKey(new Date("2026-09-07T00:00:00Z"))).not.toBe(
      isoWeekKey(new Date("2026-09-06T00:00:00Z")),
    );
  });
});

describe("medianWeeklyCheque", () => {
  it("medians per-week sums, excludes gap weeks", () => {
    const orders = [
      order("2026-08-03T10:00:00Z", 100), // week A
      order("2026-08-05T10:00:00Z", 100), // week A → 200
      order("2026-08-17T10:00:00Z", 400), // week C (week B is a gap, not 0)
    ];
    expect(medianWeeklyCheque(orders)).toBe(300); // median of [200, 400]
  });

  it("returns null with no orders", () => {
    expect(medianWeeklyCheque([])).toBeNull();
  });

  it("averages the two middle weeks for an even count", () => {
    const orders = [
      order("2026-06-01T10:00:00Z", 100),
      order("2026-06-08T10:00:00Z", 200),
      order("2026-06-15T10:00:00Z", 300),
      order("2026-06-22T10:00:00Z", 400),
    ];
    expect(medianWeeklyCheque(orders)).toBe(250);
  });
});

describe("extractBrand", () => {
  it("pulls a quoted brand token", () => {
    expect(extractBrand("Молоко «Галичина» 2.5%")).toBe("Галичина");
    expect(extractBrand('Вода "Моршинська" 1.5л')).toBe("Моршинська");
  });
  it("returns null when there is no quoted token", () => {
    expect(extractBrand("Персик ваговий")).toBeNull();
    expect(extractBrand("Хліб")).toBeNull();
  });
});

describe("tallyBrands", () => {
  it("counts quoted-brand purchases, ignores voids, sorts desc", () => {
    const orders = [
      order("2026-08-01T10:00:00Z", 0, [
        line("a", "Сир «Комо»", 1),
        line("b", "Молоко «Галичина»", 1),
      ]),
      order("2026-08-08T10:00:00Z", 0, [
        line("b", "Молоко «Галичина»", 1),
        line("c", "Кефір «Галичина»", -1), // void — not counted
      ]),
    ];
    const brands = tallyBrands(orders);
    expect(brands[0]).toMatchObject({ brand: "Галичина", purchases: 2 });
    expect(brands.map((b) => b.brand)).toEqual(["Галичина", "Комо"]);
  });
});

describe("buildConsumptionModel", () => {
  const orders: RetailOrder[] = [
    order("2026-07-06T10:00:00Z", 500, [line("milk", "Молоко", 1), line("bread", "Хліб", 2)]),
    order("2026-07-20T10:00:00Z", 600, [line("milk", "Молоко", 1), line("eggs", "Яйця", 1)]),
    order("2026-08-17T10:00:00Z", 400, [
      line("milk", "Молоко", 1),
      line("milk", "Молоко", -1), // same-order void nets milk to 0 for this order
      line("bread", "Хліб", 1),
    ]),
  ];

  it("aggregates buy frequency, order share, window; sorted desc", () => {
    const m = buildConsumptionModel(orders, NOW);
    expect(m.orderCount).toBe(3);
    expect(m.window).toEqual({
      start: "2026-07-06T10:00:00.000Z",
      end: "2026-08-17T10:00:00.000Z",
    });
    const milk = m.buyFrequency.find((b) => b.key === "milk")!;
    // milk bought in orders 1 & 2 (order 3 nets to 0) → orderShare 2/3
    expect(milk.orderShare).toBeCloseTo(0.667, 2);
    const bread = m.buyFrequency.find((b) => b.key === "bread")!;
    expect(bread.orderShare).toBeCloseTo(0.667, 2);
    // sorted by buysPer4Weeks desc
    const freqs = m.buyFrequency.map((b) => b.buysPer4Weeks);
    expect([...freqs].sort((a, b) => b - a)).toEqual(freqs);
  });

  it("is deterministic for the same orders + now", () => {
    expect(buildConsumptionModel(orders, NOW)).toEqual(buildConsumptionModel([...orders], NOW));
  });

  it("returns an empty model for no orders", () => {
    expect(buildConsumptionModel([], NOW)).toEqual({
      source: "receipts",
      orderCount: 0,
      window: null,
      medianWeeklyChequeUah: null,
      buyFrequency: [],
      brandAffinity: [],
    });
  });

  it("keeps a catalogProduct:null line via its lager key and counts it", () => {
    const m = buildConsumptionModel(
      [order("2026-08-01T10:00:00Z", 50, [line("lager:999", "Ноунейм", 1)])],
      NOW,
    );
    expect(m.buyFrequency.map((b) => b.key)).toContain("lager:999");
  });
});
