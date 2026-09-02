import { describe, expect, it } from "vitest";

import {
  planDetailSchema,
  planGenerateResultSchema,
  planGetResultSchema,
  planItemSchema,
} from "./plan.js";

const item = {
  dayIndex: 1,
  recipeId: "11111111-1111-1111-1111-111111111111",
  slug: "borshch",
  titleUk: "Борщ",
  servings: 3,
  costUah: 120.5,
  promoShareUah: 40,
  macrosPerServing: { kcal: 520, protein: 28, fat: 18, carbs: 60 },
  pinned: false,
  outcome: null,
};

const line = {
  ingredientId: "22222222-2222-2222-2222-222222222222",
  slug: "carrot",
  nameUk: "Морква",
  neededAmount: 300,
  unit: "g",
  productRef: "sku-1",
  companyId: "co",
  branchId: "br",
  productName: "Морква вагова",
  packSize: 1000,
  packCount: 1,
  price: 18.9,
  oldPrice: null,
  isPromo: false,
  confidence: 0.82,
  decision: "accepted" as const,
  needsConfirmation: false,
  outOfStock: false,
  blockReason: null,
  userOverridden: false,
};

describe("plan schemas", () => {
  it("round-trips a plan detail", () => {
    const detail = {
      id: "33333333-3333-3333-3333-333333333333",
      goal: "routine" as const,
      seed: 7,
      days: 5,
      budgetUah: 2500,
      status: "draft" as const,
      totalEstUah: 2310.4,
      promoSharePct: 32.5,
      estimatedCostUah: 0,
      unpricedLineCount: 0,
      proteinFloorMet: true,
      kcalCorridorMet: false,
      explanation: "План на 5 днів…",
      createdAt: new Date().toISOString(),
      items: [item],
      list: [line],
    };
    expect(planDetailSchema.parse(detail)).toEqual(detail);
  });

  it("allows a null recipe_id / macros / explanation", () => {
    expect(() =>
      planItemSchema.parse({ ...item, recipeId: null, macrosPerServing: null }),
    ).not.toThrow();
  });

  it("discriminates the generate result union", () => {
    expect(planGenerateResultSchema.parse({ status: "ok", planId: item.recipeId })).toEqual({
      status: "ok",
      planId: item.recipeId,
    });
    expect(
      planGenerateResultSchema.parse({ status: "infeasible", reason: "бюджет", shortfallUah: 180 }),
    ).toMatchObject({ status: "infeasible", shortfallUah: 180 });
    expect(planGenerateResultSchema.parse({ status: "auth_required" })).toEqual({
      status: "auth_required",
    });
  });

  it("discriminates the get result union", () => {
    expect(planGetResultSchema.parse({ status: "not_found" })).toEqual({ status: "not_found" });
  });
});
