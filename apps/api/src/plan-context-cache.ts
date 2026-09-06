import type { MapperResult } from "@navar/domain";
import type { SolverInput } from "@navar/planner";

import type { PlanContext } from "./plan.js";
import { connection } from "./queue/connection.js";

/**
 * Plan-context cache (T4.2) — the solver input a plan was built from, kept so an edit
 * (`plan.replaceItem` / `plan.cheaper`) doesn't have to rebuild it.
 *
 * Rebuilding costs ~13.7 s on a cold provider: the mapper prices the **whole** 50-recipe
 * corpus (94 unique ingredient queries), and the dominant term is the sequential, uncached
 * LLM re-ranks inside `mapPlan`. `NFR-PERF-003` gives item replacement p95 < 8 s, so the
 * rebuild has to be avoided, not merely optimised.
 *
 * Redis (not an in-process Map) because the API is containerised and may run more than one
 * replica — same reasoning as sessions and the cart preview guard, and the same
 * `navar:*` + `EX` idiom.
 *
 * Caching prices carries an obligation: **`NFR-DATA-002` forbids serving prices older than
 * 60 min**, so the TTL is the ceiling and a miss must rebuild rather than degrade.
 */

const PREFIX = "navar:plan:ctx:";
/** 55 min — inside `NFR-DATA-002`'s 60-min price ceiling, with slack for a slow request. */
const TTL_S = 55 * 60;

/** The serialisable slice of `PlanContext`. `retailError` and the counts are not needed. */
export interface CachedPlanContext {
  input: SolverInput;
  mapperResult: MapperResult | null;
  idBySlug: Map<string, string>;
  recipeSlugIngredients: Map<string, string[]>;
}

/** Wire shape — `Map`s become entry arrays, which is all `JSON.stringify` would otherwise drop. */
interface WirePlanContext {
  input: Omit<SolverInput, "prices" | "nutrition" | "pantry"> & {
    prices: [string, SolverInput["prices"] extends Map<string, infer V> ? V : never][];
    nutrition: [string, unknown][];
    pantry: [string, number][];
  };
  mapperResult: MapperResult | null;
  idBySlug: [string, string][];
  recipeSlugIngredients: [string, string[]][];
}

/**
 * `Map` → entry arrays. Every `Map` in `SolverInput` must be listed here: a silently dropped
 * `prices` map would leave the solver with no prices at all, which degrades a plan to
 * "free but promoless" rather than failing loudly.
 */
export function toWire(ctx: CachedPlanContext): WirePlanContext {
  const { prices, nutrition, pantry, ...rest } = ctx.input;
  return {
    input: {
      ...rest,
      prices: [...prices.entries()],
      nutrition: [...nutrition.entries()],
      pantry: [...pantry.entries()],
    },
    mapperResult: ctx.mapperResult,
    idBySlug: [...ctx.idBySlug.entries()],
    recipeSlugIngredients: [...ctx.recipeSlugIngredients.entries()],
  };
}

/** Entry arrays → `Map`. Inverse of `toWire`; the pair is covered by a round-trip test. */
export function fromWire(wire: WirePlanContext): CachedPlanContext {
  const { prices, nutrition, pantry, ...rest } = wire.input;
  return {
    input: {
      ...rest,
      prices: new Map(prices),
      nutrition: new Map(nutrition as never),
      pantry: new Map(pantry),
    } as SolverInput,
    mapperResult: wire.mapperResult,
    idBySlug: new Map(wire.idBySlug),
    recipeSlugIngredients: new Map(wire.recipeSlugIngredients),
  };
}

/** Cache the context a plan was generated from. Best-effort — a failure must not fail the plan. */
export async function savePlanContext(planId: string, ctx: CachedPlanContext): Promise<void> {
  try {
    await connection.set(PREFIX + planId, JSON.stringify(toWire(ctx)), "EX", TTL_S);
  } catch (err) {
    console.warn(`[plan] could not cache context for ${planId}:`, err);
  }
}

/**
 * The cached context, or `null` on a miss / malformed entry. A miss is normal (expired TTL,
 * a restart, another replica) — the caller rebuilds, which is correct but slow, so it is
 * logged rather than swallowed.
 */
export async function loadPlanContext(planId: string): Promise<CachedPlanContext | null> {
  try {
    const raw = await connection.get(PREFIX + planId);
    if (!raw) return null;
    return fromWire(JSON.parse(raw) as WirePlanContext);
  } catch (err) {
    console.warn(`[plan] unusable cached context for ${planId}:`, err);
    return null;
  }
}

/** Drop a plan's cached context (its prices no longer describe the plan). */
export async function forgetPlanContext(planId: string): Promise<void> {
  await connection.del(PREFIX + planId);
}

/** Re-exported so callers don't duplicate the constant in tests. */
export const PLAN_CONTEXT_TTL_S = TTL_S;

/** Narrow a full `PlanContext` to the part worth caching. */
export function toCacheable(ctx: PlanContext): CachedPlanContext {
  return {
    input: ctx.input,
    mapperResult: ctx.mapperResult,
    idBySlug: ctx.idBySlug,
    recipeSlugIngredients: ctx.recipeSlugIngredients,
  };
}
