import type {
  HelloResult,
  IngredientSkuCandidate,
  McpToolsResult,
  RecipeShoppingResult,
  RecipeSummary,
} from "@navar/domain";
import { AuthRequiredError, NoCartError } from "@navar/retail";
import { z } from "zod";

import { householdRouter } from "./routers/household.js";
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  household: householdRouter,

  hello: publicProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80).optional() }).optional())
    .query(({ input }): HelloResult => {
      const who = input?.name ?? "Guest";
      return { message: `Привіт, ${who}! Navar backend is up.`, now: new Date().toISOString() };
    }),

  recipes: router({
    list: publicProcedure.query(async ({ ctx }): Promise<RecipeSummary[]> => {
      const rows = await ctx.db.query.recipes.findMany({
        with: { ingredients: { with: { ingredient: true } } },
        orderBy: (r, { asc }) => asc(r.titleUk),
      });
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.titleUk,
        servings: r.servings,
        totalMinutes: r.totalMinutes,
        difficulty: r.difficulty,
        tags: r.tags,
        allergens: r.allergens,
        ingredients: r.ingredients.map((ri) => ri.ingredient.nameUk),
        macros:
          r.kcalServing == null
            ? null
            : {
                kcal: Number(r.kcalServing),
                protein: Number(r.proteinServing),
                fat: Number(r.fatServing),
                carbs: Number(r.carbsServing),
              },
      }));
    }),

    /**
     * For each ingredient of a recipe, the single Silpo SKU to buy it (naive first-match:
     * first in-stock candidate, else first candidate). This is a demo of the live MCP —
     * the real ingredient↔SKU mapping (pg_trgm + pgvector + scoring + safety gate) is
     * `@navar/mapper` (TDD §5), still a stub.
     */
    skuCandidates: publicProcedure
      .input(z.object({ recipeId: z.string().uuid() }))
      .query(async ({ ctx, input }): Promise<RecipeShoppingResult> => {
        const recipe = await ctx.db.query.recipes.findFirst({
          where: (r, { eq }) => eq(r.id, input.recipeId),
          with: { ingredients: { with: { ingredient: true } } },
        });
        if (!recipe) return { status: "error", message: "recipe not found" };

        const ingredients = recipe.ingredients.map((ri) => ri.ingredient.nameUk);

        try {
          const results = await ctx.retail.findProducts(ingredients);
          const items: IngredientSkuCandidate[] = results.map((res) => {
            const match = res.products.find((p) => p.inStock) ?? res.products[0] ?? null;
            return { ingredient: res.query, query: res.query, match };
          });
          const matched = items.filter((i) => i.match !== null);
          return {
            status: "ok",
            branchId: results[0]?.products[0]?.branchId ?? "",
            items,
            totalUah:
              Math.round(matched.reduce((s, i) => s + (i.match?.price ?? 0), 0) * 100) / 100,
            matchedCount: matched.length,
          };
        } catch (err) {
          if (err instanceof AuthRequiredError) return { status: "auth_required", hint: err.hint };
          if (err instanceof NoCartError) return { status: "no_cart", hint: err.message };
          return { status: "error", message: err instanceof Error ? err.message : String(err) };
        }
      }),
  }),

  mcp: router({
    listTools: publicProcedure.query(({ ctx }): Promise<McpToolsResult> => ctx.retail.listTools()),
  }),
});

export type AppRouter = typeof appRouter;
