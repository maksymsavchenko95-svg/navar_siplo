import { describe, expect, it } from "vitest";

import {
  consumptionModelSchema,
  householdMemberSchema,
  householdPortraitSchema,
  householdResultSchema,
  inferConsumptionOutputSchema,
  onboardingAnswersSchema,
  parsedRestrictionSchema,
  parseRestrictionsOutputSchema,
  retailOrderSchema,
  setMembersInputSchema,
} from "./household.js";

describe("consumptionModelSchema", () => {
  const valid = {
    source: "receipts",
    orderCount: 12,
    window: { start: "2026-03-01T00:00:00Z", end: "2026-08-31T00:00:00Z" },
    medianWeeklyChequeUah: 1850,
    buyFrequency: [
      {
        key: "milk",
        label: "Молоко",
        category: "dairy_eggs",
        buysPer4Weeks: 3.5,
        avgQuantity: 1,
        unit: "l",
        lastBoughtDaysAgo: 4,
        orderShare: 0.6,
      },
    ],
    brandAffinity: [
      { brand: "Галичина", category: "dairy_eggs", purchases: 5, categoryShare: 0.4 },
    ],
  };

  it("accepts a valid model", () => {
    expect(() => consumptionModelSchema.parse(valid)).not.toThrow();
  });

  it("rejects an unknown source and an out-of-range orderShare", () => {
    expect(() => consumptionModelSchema.parse({ ...valid, source: "guess" })).toThrow();
    expect(() =>
      consumptionModelSchema.parse({
        ...valid,
        buyFrequency: [{ ...valid.buyFrequency[0], orderShare: 1.5 }],
      }),
    ).toThrow();
  });
});

describe("retailOrderSchema", () => {
  it("allows a negative line quantity (a void)", () => {
    const parsed = retailOrderSchema.parse({
      source: "offline",
      externalId: "4227-1",
      createdAt: "2026-08-17T20:11:07Z",
      total: 479.55,
      discount: 81,
      lines: [
        {
          key: "name:Томат Черрі",
          name: "Томат Черрі",
          slug: null,
          unitPrice: 99,
          quantity: -1,
          lineTotal: -99,
          unit: "кг",
          catalogProductId: null,
        },
      ],
    });
    expect(parsed.lines[0]!.quantity).toBe(-1);
  });
});

describe("parseRestrictionsOutputSchema", () => {
  it("accepts a parsed restriction", () => {
    const r = { kind: "allergen", code: "milk", severity: "strict", sourceText: "без молока" };
    expect(() => parsedRestrictionSchema.parse(r)).not.toThrow();
    expect(() => parseRestrictionsOutputSchema.parse({ restrictions: [r] })).not.toThrow();
  });

  it("rejects an empty code", () => {
    expect(() =>
      parsedRestrictionSchema.parse({ kind: "diet", code: "", severity: "soft", sourceText: "x" }),
    ).toThrow();
  });

  it("enforces the code vocabulary per kind (F2)", () => {
    const base = { severity: "strict", sourceText: "x" } as const;
    // allergen code must be an EU-14 value
    expect(() =>
      parsedRestrictionSchema.parse({ kind: "allergen", code: "lactose", ...base }),
    ).toThrow();
    expect(() =>
      parsedRestrictionSchema.parse({ kind: "allergen", code: "gluten ", ...base }),
    ).toThrow();
    expect(() =>
      parsedRestrictionSchema.parse({ kind: "allergen", code: "milk", ...base }),
    ).not.toThrow();
    // diet code must be a dietCodeSchema value
    expect(() => parsedRestrictionSchema.parse({ kind: "diet", code: "paleo", ...base })).toThrow();
    expect(() =>
      parsedRestrictionSchema.parse({ kind: "diet", code: "vegan", ...base }),
    ).not.toThrow();
    // dislike stays a free ingredient slug / name key
    expect(() =>
      parsedRestrictionSchema.parse({ kind: "dislike", code: "name:кріп", ...base }),
    ).not.toThrow();
  });
});

describe("inferConsumptionOutputSchema", () => {
  it("caps tags at 6 and bounds the summary length", () => {
    expect(() =>
      inferConsumptionOutputSchema.parse({
        tags: [
          "batch_cooks",
          "budget_conscious",
          "meat_heavy",
          "brand_loyal",
          "quick_meals",
          "premium_leaning",
          "plant_leaning",
        ],
        summary: "ok",
      }),
    ).toThrow();
    expect(() =>
      inferConsumptionOutputSchema.parse({ tags: [], summary: "x".repeat(500) }),
    ).toThrow();
  });
});

describe("householdPortraitSchema", () => {
  it("requires isAssumption to be true", () => {
    const base = {
      isAssumption: true,
      summary: null,
      tags: [],
      oftenBought: [],
      rarelyBought: [],
      allergies: [],
    };
    expect(() => householdPortraitSchema.parse(base)).not.toThrow();
    expect(() => householdPortraitSchema.parse({ ...base, isAssumption: false })).toThrow();
  });
});

describe("onboardingAnswersSchema", () => {
  it("requires at least one adult", () => {
    expect(() =>
      onboardingAnswersSchema.parse({
        weeklyBudgetUah: 2000,
        adults: 0,
        children: [],
        restrictionPhrases: [],
        dislikedPhrases: [],
        cookingWeekdays: [1, 3, 5],
        maxPrepMinutes: 40,
      }),
    ).toThrow();
  });
});

describe("householdMemberSchema", () => {
  it("defaults source to 'silpo' when omitted", () => {
    const m = householdMemberSchema.parse({ kind: "adult", ageYears: null, label: null });
    expect(m.source).toBe("silpo");
  });

  it("accepts an explicit guest source", () => {
    expect(() =>
      householdMemberSchema.parse({ kind: "child", ageYears: null, label: null, source: "guest" }),
    ).not.toThrow();
  });

  it("rejects an unknown source", () => {
    expect(() =>
      householdMemberSchema.parse({ kind: "adult", ageYears: null, label: null, source: "mcp" }),
    ).toThrow();
  });
});

describe("setMembersInputSchema", () => {
  it("accepts adults 1-12 and children 0-12", () => {
    expect(() => setMembersInputSchema.parse({ adults: 4, children: 2 })).not.toThrow();
    expect(() => setMembersInputSchema.parse({ adults: 1, children: 0 })).not.toThrow();
    expect(() => setMembersInputSchema.parse({ adults: 12, children: 12 })).not.toThrow();
  });

  it("rejects fewer than one adult", () => {
    expect(() => setMembersInputSchema.parse({ adults: 0, children: 0 })).toThrow();
  });

  it("rejects counts above 12", () => {
    expect(() => setMembersInputSchema.parse({ adults: 13, children: 0 })).toThrow();
    expect(() => setMembersInputSchema.parse({ adults: 2, children: 13 })).toThrow();
  });

  it("rejects non-integer counts", () => {
    expect(() => setMembersInputSchema.parse({ adults: 2.5, children: 0 })).toThrow();
  });
});

describe("householdResultSchema", () => {
  it("discriminates ok vs not_bootstrapped", () => {
    expect(() => householdResultSchema.parse({ status: "not_bootstrapped" })).not.toThrow();
    expect(() =>
      householdResultSchema.parse({
        status: "ok",
        household: {
          id: "00000000-0000-0000-0000-000000000001",
          goal: "form",
          weeklyBudgetUah: 2500,
          branchId: null,
          deliveryType: null,
          bootstrapStatus: "done",
          nutritionTargets: null,
        },
        members: [{ kind: "adult", ageYears: null, label: "A" }],
        restrictions: [],
        consumptionModel: null,
        preferences: null,
      }),
    ).not.toThrow();
  });

  it("accepts a populated nutritionTargets object (form goal, post-computeNutrition)", () => {
    expect(() =>
      householdResultSchema.parse({
        status: "ok",
        household: {
          id: "00000000-0000-0000-0000-000000000001",
          goal: "form",
          weeklyBudgetUah: 2500,
          branchId: null,
          deliveryType: null,
          bootstrapStatus: "done",
          nutritionTargets: { kcalTarget: 2400, proteinMinG: 140 },
        },
        members: [{ kind: "adult", ageYears: null, label: "A" }],
        restrictions: [],
        consumptionModel: null,
        preferences: null,
      }),
    ).not.toThrow();
  });
});
