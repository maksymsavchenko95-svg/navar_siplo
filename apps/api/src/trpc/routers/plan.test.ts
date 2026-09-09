import { db } from "@navar/db";
import type { ProductDetails, ProductMatch, ProductSearchResult } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { resolveHouseholdId } from "../../household.js";
import type { Context } from "../context.js";
import { appRouter } from "../router.js";
import { testContext } from "../test-context.js";

const sku = (
  over: Partial<ProductMatch> & Pick<ProductMatch, "productId" | "name">,
): ProductMatch => ({
  externalProductId: null,
  companyId: "co",
  branchId: "br-1",
  slug: over.productId,
  price: 25,
  oldPrice: null,
  packSize: "500г",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  specialPrices: [],
  ...over,
});

const cleanDetails = (slug: string): ProductDetails => ({
  slug,
  name: slug,
  price: 25,
  oldPrice: null,
  inStock: true,
  weighted: false,
  packSize: "500г",
  step: null,
  attributes: {},
  composition: "інгредієнти",
  allergens: [],
  kcal100: null,
  protein100: null,
  fat100: null,
  carbs100: null,
});

async function ctx(): Promise<Context> {
  const householdId = (await resolveHouseholdId()) ?? "test-household";
  const retail = {
    findProducts: vi.fn(async (queries: string[]): Promise<ProductSearchResult[]> =>
      queries.map((query) => ({
        query,
        products: [sku({ productId: `${query}-1`, name: query })],
      })),
    ),
    getReplacements: async () => [],
    getProductDetails: vi.fn(async (s: string) => cleanDetails(s)),
    getPromotions: async () => [],
    getMyPromos: async () => [],
  } as unknown as Context["retail"];
  return testContext({ householdId, retail });
}

describe.skipIf(!process.env.DATABASE_URL)("plan router (integration)", () => {
  it("generate → get round-trips a persisted plan with an explanation", async () => {
    const caller = appRouter.createCaller(await ctx());
    const gen = await caller.plan.generate({ goal: "routine", budgetUah: 6000, seed: 11 });
    expect(gen.status).toBe("ok");
    if (gen.status !== "ok") return;

    const got = await caller.plan.get({ planId: gen.planId });
    expect(got.status).toBe("ok");
    if (got.status !== "ok") return;
    expect(got.plan.items).toHaveLength(5);
    expect(got.plan.list.length).toBeGreaterThan(0);
    expect(got.plan.explanation).toBeTruthy();
    expect(got.plan.seed).toBe(11);
    expect(got.plan.totalEstUah).toBeLessThanOrEqual(6000);

    // B2 — cook time comes from the linked recipe (seeded corpus → all present, positive int)
    for (const item of got.plan.items) {
      expect(item.totalMinutes).not.toBeNull();
      expect(Number.isInteger(item.totalMinutes)).toBe(true);
      expect(item.totalMinutes!).toBeGreaterThan(0);
    }
    // B3 — savingsUah is computed on plan.get (a number), but null on the list header
    expect(typeof got.plan.savingsUah).toBe("number");
    expect(got.plan.savingsUah!).toBeGreaterThanOrEqual(0);
    const list = await caller.plan.list();
    expect(list.find((p) => p.id === gen.planId)?.savingsUah).toBeNull();

    // cleanup
    const { schema } = await import("@navar/db");
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.plans).where(eq(schema.plans.id, gen.planId));
  }, 120_000);

  it("get with a foreign planId → not_found", async () => {
    const caller = appRouter.createCaller(await ctx());
    const res = await caller.plan.get({ planId: "00000000-0000-0000-0000-000000000000" });
    expect(res).toEqual({ status: "not_found" });
  });
});
