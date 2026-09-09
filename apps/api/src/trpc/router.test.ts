import { db } from "@navar/db";
import type { ProductDetails, ProductMatch, ProductSearchResult } from "@navar/domain";
import { AuthRequiredError } from "@navar/retail";
import { describe, expect, it, vi } from "vitest";

import { resolveHouseholdId } from "../household.js";
import type { Context } from "./context.js";
import { appRouter } from "./router.js";
import { testContext } from "./test-context.js";

const sku = (
  over: Partial<ProductMatch> & Pick<ProductMatch, "productId" | "name">,
): ProductMatch => ({
  externalProductId: null,
  companyId: "co",
  branchId: "br-1",
  slug: over.productId,
  price: 30,
  oldPrice: null,
  packSize: "500г",
  imageUrl: null,
  inStock: true,
  weighted: false,
  step: null,
  specialPrices: [],
  ...over,
});

/** A clean product card — no allergens, composition present → the SKU gate passes it. */
const cleanDetails = (slug: string): ProductDetails => ({
  slug,
  name: slug,
  price: 30,
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

function fakeRetail(over: Partial<Context["retail"]> = {}): Context["retail"] {
  return {
    findProducts: vi.fn(async (queries: string[]): Promise<ProductSearchResult[]> =>
      queries.map((query) => ({
        query,
        products: [sku({ productId: `${query}-1`, name: query })],
      })),
    ),
    getReplacements: async () => [],
    getProductDetails: vi.fn(async (slug: string) => cleanDetails(slug)),
    ...over,
  } as Context["retail"];
}

async function ctxWith(retail: Partial<Context["retail"]>): Promise<Context> {
  const householdId = (await resolveHouseholdId()) ?? "test-household";
  return testContext({ householdId, retail: fakeRetail(retail) });
}

describe.skipIf(!process.env.DATABASE_URL)("recipes.skuCandidates (integration)", () => {
  it("maps a seeded recipe's ingredients and returns the ok shape", async () => {
    const recipe = await db.query.recipes.findFirst();
    if (!recipe) throw new Error("no recipes — run pnpm db:seed");

    const caller = appRouter.createCaller(await ctxWith({}));
    const res = await caller.recipes.skuCandidates({ recipeId: recipe.id });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0]).toHaveProperty("confidence");
    expect(res.items[0]).toHaveProperty("blocked");
    expect(res.matchedCount).toBeGreaterThan(0);
  });

  it("blocks a gluten-bearing ingredient for the seeded (gluten-allergic) demo household", async () => {
    const recipe = await db.query.recipes.findFirst({
      where: (r, { eq }) => eq(r.slug, "cottage_cheese_syrniki"),
      with: { ingredients: { with: { ingredient: true } } },
    });
    if (!recipe) throw new Error("recipe cottage_cheese_syrniki missing — run pnpm db:seed");

    const caller = appRouter.createCaller(await ctxWith({}));
    const res = await caller.recipes.skuCandidates({ recipeId: recipe.id });
    if (res.status !== "ok") throw new Error(`expected ok, got ${res.status}`);

    const flour = res.items.find((i) => i.ingredient.toLowerCase().includes("борошно"));
    expect(flour?.blocked).toBe(true);
    expect(flour?.blockReason).toMatch(/глютен/);
    expect(flour?.match).toBeNull();
    expect(res.blockedCount).toBeGreaterThanOrEqual(1);
  });

  it("surfaces AuthRequiredError as auth_required", async () => {
    const recipe = await db.query.recipes.findFirst();
    if (!recipe) throw new Error("no recipes — run pnpm db:seed");

    const caller = appRouter.createCaller(
      await ctxWith({
        findProducts: async () => {
          throw new AuthRequiredError("run mcp:auth");
        },
      }),
    );
    const res = await caller.recipes.skuCandidates({ recipeId: recipe.id });
    expect(res).toEqual({ status: "auth_required", hint: "run mcp:auth" });
  });

  it("returns an error for an unknown recipe id", async () => {
    const caller = appRouter.createCaller(await ctxWith({}));
    const res = await caller.recipes.skuCandidates({
      recipeId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res).toEqual({ status: "error", message: "recipe not found" });
  });
});
