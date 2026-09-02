import { db } from "@navar/db";
import type { ProductMatch, ProductSearchResult } from "@navar/domain";
import { AuthRequiredError } from "@navar/retail";
import { describe, expect, it, vi } from "vitest";

import { getLlm, getLlmTracer } from "../llm.js";
import { appRouter } from "./router.js";
import type { Context } from "./context.js";

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
  ...over,
});

function ctxWith(retail: Partial<Context["retail"]>): Context {
  return {
    db,
    retail: retail as Context["retail"],
    llm: getLlm(),
    tracer: getLlmTracer(),
  } as Context;
}

describe.skipIf(!process.env.DATABASE_URL)("recipes.skuCandidates (integration)", () => {
  it("maps a seeded recipe's ingredients and returns the ok shape", async () => {
    const recipe = await db.query.recipes.findFirst();
    if (!recipe) throw new Error("no recipes — run pnpm db:seed");

    const findProducts = vi.fn(async (queries: string[]): Promise<ProductSearchResult[]> =>
      queries.map((query) => ({
        query,
        products: [sku({ productId: `${query}-1`, name: query })],
      })),
    );
    const caller = appRouter.createCaller(
      ctxWith({ findProducts, getReplacements: async () => [] }),
    );

    const res = await caller.recipes.skuCandidates({ recipeId: recipe.id });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0]).toHaveProperty("confidence");
    expect(res.items[0]).toHaveProperty("packCount");
    expect(res.matchedCount).toBeGreaterThan(0);
    expect(findProducts).toHaveBeenCalled();
  });

  it("surfaces AuthRequiredError as auth_required", async () => {
    const recipe = await db.query.recipes.findFirst();
    if (!recipe) throw new Error("no recipes — run pnpm db:seed");

    const caller = appRouter.createCaller(
      ctxWith({
        findProducts: async () => {
          throw new AuthRequiredError("run mcp:auth");
        },
        getReplacements: async () => [],
      }),
    );
    const res = await caller.recipes.skuCandidates({ recipeId: recipe.id });
    expect(res).toEqual({ status: "auth_required", hint: "run mcp:auth" });
  });

  it("returns an error for an unknown recipe id", async () => {
    const caller = appRouter.createCaller(ctxWith({ findProducts: async () => [] }));
    const res = await caller.recipes.skuCandidates({
      recipeId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res).toEqual({ status: "error", message: "recipe not found" });
  });
});
