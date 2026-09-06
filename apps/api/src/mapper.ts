import { db, schema } from "@navar/db";
import {
  hasShelfMarkdown,
  type Macros,
  type ProductDetails,
  type SkuMatch,
  type StoredRestriction,
} from "@navar/domain";
import { llmRerank } from "@navar/llm";
import type {
  IngredientSafetyCheck,
  MapperDictEntry,
  RerankFn,
  SkuSafetyCheck,
} from "@navar/mapper";
import type { RetailProvider } from "@navar/retail";
import type { SolverInput } from "@navar/planner";
import {
  checkIngredient,
  checkSku,
  type Exclusions,
  needsSkuCheck,
  resolveExclusions,
} from "@navar/safety";
import { eq, inArray } from "drizzle-orm";

import { getLlm, getLlmTracer } from "./llm.js";

/**
 * Load the dictionary rows a plan needs, in the shape `@navar/mapper` consumes. The DB row
 * is authoritative (identical to `CANONICAL_INGREDIENTS` today, but an edit lands here
 * first). Drizzle `numeric` columns come back as strings.
 */
export async function loadMapperDict(slugs: string[]): Promise<Map<string, MapperDictEntry>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({
      slug: schema.canonicalIngredients.slug,
      nameUk: schema.canonicalIngredients.nameUk,
      category: schema.canonicalIngredients.category,
      baseUnit: schema.canonicalIngredients.baseUnit,
      densityGMl: schema.canonicalIngredients.densityGMl,
      gramsPerPiece: schema.canonicalIngredients.gramsPerPiece,
      synonyms: schema.canonicalIngredients.synonyms,
      allergens: schema.canonicalIngredients.allergens,
    })
    .from(schema.canonicalIngredients)
    .where(inArray(schema.canonicalIngredients.slug, slugs));

  return new Map(
    rows.map((r) => [
      r.slug,
      {
        slug: r.slug,
        nameUk: r.nameUk,
        category: r.category as MapperDictEntry["category"],
        baseUnit: r.baseUnit as MapperDictEntry["baseUnit"],
        densityGMl: r.densityGMl == null ? null : Number(r.densityGMl),
        gramsPerPiece: r.gramsPerPiece == null ? null : Number(r.gramsPerPiece),
        synonyms: r.synonyms ?? [],
        allergens: r.allergens ?? [],
      },
    ]),
  );
}

/** `slug → canonical_ingredients.id` for the slugs given (T2.3 SolverInput assembly). */
export async function loadIdBySlug(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.canonicalIngredients.id, slug: schema.canonicalIngredients.slug })
    .from(schema.canonicalIngredients)
    .where(inArray(schema.canonicalIngredients.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** Per-100g `Macros` by `canonical_ingredients.id` — fills `SolverInput.nutrition` (T2.3). */
export async function loadIngredientMacros(ids: string[]): Promise<Map<string, Macros>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.canonicalIngredients.id,
      kcal100: schema.canonicalIngredients.kcal100,
      protein100: schema.canonicalIngredients.protein100,
      fat100: schema.canonicalIngredients.fat100,
      carbs100: schema.canonicalIngredients.carbs100,
      fiber100: schema.canonicalIngredients.fiber100,
    })
    .from(schema.canonicalIngredients)
    .where(inArray(schema.canonicalIngredients.id, ids));
  const out = new Map<string, Macros>();
  for (const r of rows) {
    if (r.kcal100 == null) continue;
    out.set(r.id, {
      kcal: Number(r.kcal100),
      protein: Number(r.protein100 ?? 0),
      fat: Number(r.fat100 ?? 0),
      carbs: Number(r.carbs100 ?? 0),
      fiber: Number(r.fiber100 ?? 0),
    });
  }
  return out;
}

/** The household's hard exclusions (`@navar/safety`) — empty when the household is unknown. */
export async function loadExclusions(householdId: string): Promise<Exclusions> {
  const rows = await db
    .select({
      kind: schema.householdRestrictions.kind,
      code: schema.householdRestrictions.code,
      severity: schema.householdRestrictions.severity,
      source: schema.householdRestrictions.source,
      confirmedAt: schema.householdRestrictions.confirmedAt,
    })
    .from(schema.householdRestrictions)
    .where(eq(schema.householdRestrictions.householdId, householdId));

  const stored: StoredRestriction[] = rows.map((r) => ({
    kind: r.kind as StoredRestriction["kind"],
    code: r.code,
    severity: r.severity as StoredRestriction["severity"],
    source: r.source as StoredRestriction["source"],
    confirmed: r.confirmedAt !== null,
  }));
  return resolveExclusions(stored);
}

/** `@navar/mapper`'s `IngredientSafetyCheck` bound to a household's exclusions (T2.2). */
export function makeIngredientSafety(exclusions: Exclusions): IngredientSafetyCheck {
  return (entry) => {
    const v = checkIngredient({
      slug: entry.slug,
      allergens: entry.allergens,
      exclusions,
    });
    return v.safe ? { blocked: false, reason: null } : { blocked: true, reason: v.reason };
  };
}

/**
 * `@navar/mapper`'s `SkuSafetyCheck` — targeted: fetch `get_product_details` only for a
 * chosen SKU in an allergen-risk category, then `checkSku` (fail-closed, ADR-05). A failed
 * fetch next to a declared allergy is a block, not a pass. Logs every block (`FR-SAFE-006`).
 */
export function makeSkuSafety(
  retail: RetailProvider,
  exclusions: Exclusions,
  householdId: string,
): SkuSafetyCheck {
  return async ({ slug, category, chosen }) => {
    if (!needsSkuCheck(category as Parameters<typeof needsSkuCheck>[0], exclusions)) {
      return { blocked: false, reason: null };
    }
    let details: ProductDetails;
    try {
      details = await retail.getProductDetails(chosen.slug);
    } catch (err) {
      console.warn(
        `[safety] blocked ${slug} (${chosen.slug}) hh=${householdId}: details fetch failed — ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return {
        blocked: true,
        reason: "Не додано: не вдалося перевірити склад товару, а вказано алергію.",
      };
    }
    const v = checkSku({ details, exclusions });
    if (v.safe) return { blocked: false, reason: null };
    console.warn(
      `[safety] blocked ${slug} (${chosen.slug}) hh=${householdId}: ` +
        `${v.allergens.join(",")} via ${v.source}`,
    );
    return { blocked: true, reason: v.reason };
  };
}

/** The LLM re-rank function for the mapper's close-call branch, wired to the API singletons. */
export function getRerankFn(): RerankFn {
  return llmRerank({ provider: getLlm(), tracer: getLlmTracer() });
}

/**
 * `SkuMatch[]` → the solver's price map (`SolverInput.prices`, consumed by T2.3). Resolves
 * the `packSize: string → number` question: the mapper already parsed it; when unknown we
 * substitute the needed amount so the solver's `ceil(toBuy / packSize)` yields one pack.
 */
export function skuMatchesToPrices(
  matches: readonly SkuMatch[],
  idBySlug: ReadonlyMap<string, string>,
): SolverInput["prices"] {
  const out: SolverInput["prices"] = new Map();
  for (const m of matches) {
    const id = idBySlug.get(m.slug);
    if (!id || !m.match) continue;
    out.set(id, {
      uah: m.match.price,
      // Markdown only — a multi-buy tier travels separately, since the solver may only
      // count it once the plan buys enough units to collect it (T4.1).
      promo: hasShelfMarkdown(m.match),
      packSize: m.packSize ?? m.neededAmount,
      tier: m.promoTier,
    });
  }
  return out;
}
