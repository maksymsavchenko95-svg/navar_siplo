import type { PlanDetail, PlanItem } from "@navar/domain";
import type { RecipeCandidate } from "@navar/planner";
import { describe, expect, it, vi } from "vitest";

/**
 * T4.2 — the pure guards and helpers. The DB-backed happy path is covered end to end by
 * `plan:edit-probe`; what matters most here are the **fail-closed** paths: an already
 * materialized plan must never be edited, and a plan that can't be replayed must be
 * refused rather than half-written.
 */

const { getPlanDetailMock, clearPreviewMock } = vi.hoisted(() => ({
  getPlanDetailMock: vi.fn(),
  clearPreviewMock: vi.fn(async () => {}),
}));

vi.mock("@navar/db", () => ({
  getPlanDetail: getPlanDetailMock,
  replacePlanRows: vi.fn(async () => 1),
  setPlanExplanation: vi.fn(async () => {}),
  toPlanRows: vi.fn(() => ({ plan: {}, items: [], lines: [] })),
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
  schema: { recipes: { id: "id", slug: "slug" } },
}));
vi.mock("./cart.js", () => ({ clearPreview: clearPreviewMock }));
vi.mock("./llm.js", () => ({ getLlm: () => undefined, getLlmTracer: () => undefined }));

const { applyReplacement, assignmentFrom, makeCheaper, proteinAvailable, roundScale } =
  await import("./plan-edit.js");

const retail = {} as never;

const plan = (over: Partial<PlanDetail> = {}): PlanDetail =>
  ({
    id: "11111111-1111-1111-1111-111111111111",
    householdId: "hh",
    goal: "routine",
    seed: 1,
    days: 5,
    budgetUah: 2500,
    status: "draft",
    totalEstUah: 2000,
    promoSharePct: 30,
    cartId: null,
    materializedAt: null,
    items: [],
    list: [],
    ...over,
  }) as PlanDetail;

describe("roundScale", () => {
  it("rounds to the 2 dp Postgres numeric(3,2) actually stores", () => {
    // Otherwise a reloaded plan re-costs differently from the one that was saved, and a
    // single-day swap silently shifts every other day's cost.
    expect(roundScale(1.2345)).toBe(1.23);
    expect(roundScale(1.4)).toBe(1.4);
    expect(roundScale(1)).toBe(1);
  });
});

describe("assignmentFrom", () => {
  const cand = (recipeId: string, slug: string): RecipeCandidate =>
    ({
      recipeId,
      slug,
      titleUk: slug,
      servings: 4,
      activeMinutes: 20,
      ingredients: [],
      macrosPerServing: { kcal: 700, protein: 45, fat: 20, carbs: 60, fiber: 6 },
    }) as RecipeCandidate;

  const item = (over: Partial<PlanItem>): PlanItem =>
    ({
      dayIndex: 1,
      recipeId: null,
      slug: "borshch",
      titleUk: "Борщ",
      servings: 3,
      portionScale: 1,
      costUah: 100,
      promoShareUah: 0,
      macrosPerServing: null,
      pinned: false,
      outcome: null,
      ...over,
    }) as PlanItem;

  it("orders by day and rounds the portion scale", () => {
    const out = assignmentFrom(
      [item({ dayIndex: 2, slug: "plov", portionScale: 1.2345 }), item({ dayIndex: 1 })],
      [cand("r1", "borshch"), cand("r2", "plov")],
    );
    expect(out).toEqual([
      { recipeId: "r1", portionScale: 1 },
      { recipeId: "r2", portionScale: 1.23 },
    ]);
  });

  it("falls back to slug when recipe_id is null (the importer prunes with SET NULL)", () => {
    expect(assignmentFrom([item({ recipeId: null })], [cand("r1", "borshch")])).toEqual([
      { recipeId: "r1", portionScale: 1 },
    ]);
  });

  it("returns null when a dish is no longer in the corpus, rather than guessing", () => {
    expect(assignmentFrom([item({ slug: "gone" })], [cand("r1", "borshch")])).toBeNull();
  });
});

describe("proteinAvailable (C — meal-swap bias)", () => {
  const candWith = (ingCategory: string, id: string): RecipeCandidate =>
    ({
      recipeId: "r",
      slug: "s",
      titleUk: "s",
      servings: 4,
      activeMinutes: 20,
      ingredients: [{ id, amount: 300, unit: "g", category: ingCategory, optional: false }],
      macrosPerServing: { kcal: 700, protein: 45, fat: 20, carbs: 60, fiber: 6 },
    }) as RecipeCandidate;

  const mapper = (matches: unknown[]) =>
    ({ branchId: "b", consolidated: [], matches, stats: {} }) as never;
  const slugById = new Map([["id-chicken", "chicken"]]);

  it("true when there is no mapper result or no protein ingredient", () => {
    expect(proteinAvailable(candWith("meat", "id-chicken"), null, slugById)).toBe(true);
    expect(proteinAvailable(candWith("vegetable", "id-x"), mapper([]), slugById)).toBe(true);
  });

  it("false when the protein match is sku_unknown / out of stock / wrong form", () => {
    expect(
      proteinAvailable(
        candWith("meat", "id-chicken"),
        mapper([{ slug: "chicken", decision: "sku_unknown", outOfStock: false, match: null }]),
        slugById,
      ),
    ).toBe(false);
    expect(
      proteinAvailable(
        candWith("meat", "id-chicken"),
        mapper([
          {
            slug: "chicken",
            decision: "accepted",
            outOfStock: false,
            match: { name: "Курка тушкована" },
          },
        ]),
        slugById,
      ),
    ).toBe(false);
  });

  it("true when the protein match is a normal in-stock SKU", () => {
    expect(
      proteinAvailable(
        candWith("meat", "id-chicken"),
        mapper([
          {
            slug: "chicken",
            decision: "accepted",
            outOfStock: false,
            match: { name: "Куряче філе охолоджене" },
          },
        ]),
        slugById,
      ),
    ).toBe(true);
  });
});

describe("materialize guard (fail-closed)", () => {
  it.each([
    ["status materialized", { status: "materialized" as const }],
    ["status checked_out", { status: "checked_out" as const }],
    ["a cart id present", { cartId: "cart-abc" }],
  ])("refuses applyReplacement when the plan has %s", async (_label, over) => {
    getPlanDetailMock.mockResolvedValueOnce(plan(over));
    const res = await applyReplacement(
      "11111111-1111-1111-1111-111111111111",
      "hh",
      1,
      "r9",
      retail,
    );
    expect(res.status).toBe("already_materialized");
    expect(clearPreviewMock).not.toHaveBeenCalled();
  });

  it("refuses makeCheaper on a materialized plan", async () => {
    getPlanDetailMock.mockResolvedValueOnce(plan({ status: "materialized" }));
    const res = await makeCheaper("11111111-1111-1111-1111-111111111111", "hh", 300, retail);
    expect(res.status).toBe("already_materialized");
  });

  it("reports not_found for a missing or foreign plan", async () => {
    getPlanDetailMock.mockResolvedValueOnce(null);
    expect(
      (await makeCheaper("11111111-1111-1111-1111-111111111111", "hh", 300, retail)).status,
    ).toBe("not_found");
  });

  it("rejects a non-positive saving before touching anything", async () => {
    getPlanDetailMock.mockResolvedValueOnce(plan());
    const res = await makeCheaper("11111111-1111-1111-1111-111111111111", "hh", 0, retail);
    expect(res.status).toBe("rejected");
  });
});
