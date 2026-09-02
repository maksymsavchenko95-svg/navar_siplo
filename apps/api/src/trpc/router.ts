import type {
  HelloResult,
  IngredientSkuCandidate,
  RecipeShoppingResult,
  RecipeSummary,
} from "@navar/domain";
import { mapPlan, type MapperRetail, type PlanIngredientLine } from "@navar/mapper";
import { hasHardExclusion } from "@navar/safety";
import { AuthRequiredError, NoCartError } from "@navar/retail";
import { z } from "zod";

import {
  getRerankFn,
  loadExclusions,
  loadMapperDict,
  makeIngredientSafety,
  makeSkuSafety,
} from "../mapper.js";
import { authRouter } from "./routers/auth.js";
import { householdRouter } from "./routers/household.js";
import { planRouter } from "./routers/plan.js";
import { protectedProcedure, publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  auth: authRouter,
  household: householdRouter,
  plan: planRouter,

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
     * Map a recipe's ingredients to concrete Silpo SKUs via `@navar/mapper` (TDD §5):
     * consolidate → head-noun query → deterministic score → LLM re-rank on a close call →
     * flag low-confidence matches (`FR-MAP-006`). The T2.2 safety gate runs against the
     * resolved household's allergen exclusions — blocked lines come back `blocked: true`
     * with a Guest-facing reason. Pack-size aware; `totalUah` is basket cost (price × packs).
     */
    skuCandidates: protectedProcedure
      .input(z.object({ recipeId: z.string().uuid() }))
      .query(async ({ ctx, input }): Promise<RecipeShoppingResult> => {
        const recipe = await ctx.db.query.recipes.findFirst({
          where: (r, { eq }) => eq(r.id, input.recipeId),
          with: { ingredients: { with: { ingredient: true } } },
        });
        if (!recipe) return { status: "error", message: "recipe not found" };

        const lines: PlanIngredientLine[] = recipe.ingredients.map((ri) => ({
          slug: ri.ingredient.slug,
          amount: Number(ri.amount),
          unit: ri.unit as PlanIngredientLine["unit"],
          optional: ri.optional,
        }));

        try {
          const { householdId } = ctx;
          const exclusions = await loadExclusions(householdId);
          const dict = await loadMapperDict(lines.map((l) => l.slug));
          const result = await mapPlan(
            { lines, dict },
            {
              retail: ctx.retail as MapperRetail,
              rerank: getRerankFn(),
              ...(hasHardExclusion(exclusions)
                ? {
                    ingredientSafety: makeIngredientSafety(exclusions),
                    skuSafety: makeSkuSafety(ctx.retail, exclusions, householdId),
                  }
                : {}),
            },
          );
          const items: IngredientSkuCandidate[] = result.matches.map((m) => ({
            ingredient: m.ingredientNameUk,
            query: m.query,
            match: m.match,
            confidence: m.confidence,
            needsConfirmation: m.needsConfirmation,
            packCount: m.packCount,
            surplusAmount: m.surplusAmount,
            blocked: m.decision === "blocked_unsafe",
            blockReason: m.blockReason,
          }));
          const totalUah =
            Math.round(
              result.matches.reduce((s, m) => s + (m.match ? m.match.price * m.packCount : 0), 0) *
                100,
            ) / 100;
          return {
            status: "ok",
            branchId: result.branchId,
            items,
            totalUah,
            matchedCount: result.stats.matched,
            blockedCount: result.stats.blocked,
          };
        } catch (err) {
          if (err instanceof AuthRequiredError) return { status: "auth_required", hint: err.hint };
          if (err instanceof NoCartError) return { status: "no_cart", hint: err.message };
          return { status: "error", message: err instanceof Error ? err.message : String(err) };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
