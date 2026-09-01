import type { HelloResult, McpToolsResult, RecipeSummary } from "@navar/domain";
import { z } from "zod";

import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
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
  }),

  mcp: router({
    listTools: publicProcedure.query(({ ctx }): Promise<McpToolsResult> => ctx.retail.listTools()),
  }),
});

export type AppRouter = typeof appRouter;
