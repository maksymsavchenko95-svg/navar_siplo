import type { ConsumptionModel, StoredRestriction } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { buildPortrait } from "./portrait.js";

const model: ConsumptionModel = {
  source: "receipts",
  orderCount: 10,
  window: { start: "2026-06-01T00:00:00Z", end: "2026-08-31T00:00:00Z" },
  medianWeeklyChequeUah: 1800,
  buyFrequency: [
    {
      key: "milk",
      label: "Молоко",
      category: null,
      buysPer4Weeks: 4,
      avgQuantity: 1,
      unit: "l",
      lastBoughtDaysAgo: 3,
      orderShare: 0.7,
    },
    {
      key: "bread",
      label: "Хліб",
      category: null,
      buysPer4Weeks: 3,
      avgQuantity: 1,
      unit: null,
      lastBoughtDaysAgo: 5,
      orderShare: 0.5,
    },
    {
      key: "capers",
      label: "Каперси",
      category: null,
      buysPer4Weeks: 0.2,
      avgQuantity: 1,
      unit: null,
      lastBoughtDaysAgo: 90,
      orderShare: 0.1,
    },
  ],
  brandAffinity: [],
};

const restrictions: StoredRestriction[] = [
  { kind: "allergen", code: "milk", severity: "strict", source: "mcp", confirmed: false },
  { kind: "dislike", code: "mushroom", severity: "soft", source: "inferred", confirmed: true },
];

describe("buildPortrait", () => {
  it("puts high-order-share items in oftenBought", () => {
    const p = buildPortrait(model, restrictions);
    expect(p.oftenBought.map((c) => c.label)).toEqual(["Молоко", "Хліб"]);
    expect(p.oftenBought[0]!.detail).toBe("щотижня");
  });

  it("puts rare, long-ago items in rarelyBought", () => {
    const p = buildPortrait(model, restrictions);
    expect(p.rarelyBought.map((c) => c.label)).toEqual(["Каперси"]);
  });

  it("maps restrictions to cards with the right detail", () => {
    const p = buildPortrait(model, restrictions);
    const allergy = p.allergies.find((c) => c.code === "milk")!;
    expect(allergy).toMatchObject({
      kind: "allergy",
      detail: "Суворе виключення",
      confirmed: false,
    });
    const dislike = p.allergies.find((c) => c.code === "mushroom")!;
    expect(dislike).toMatchObject({
      kind: "dislike",
      detail: "Не додаємо у страви",
      confirmed: true,
    });
  });

  it("is always an assumption and threads the infer summary/tags", () => {
    const p = buildPortrait(model, restrictions, {
      summary: "Ви часто берете молочне.",
      tags: ["fresh_produce_heavy"],
    });
    expect(p.isAssumption).toBe(true);
    expect(p.summary).toBe("Ви часто берете молочне.");
    expect(p.tags).toEqual(["fresh_produce_heavy"]);
  });

  it("with no model still returns the restriction cards", () => {
    const p = buildPortrait(null, restrictions);
    expect(p.oftenBought).toEqual([]);
    expect(p.allergies).toHaveLength(2);
  });
});
