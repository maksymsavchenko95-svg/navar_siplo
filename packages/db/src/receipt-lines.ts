/**
 * Persist the raw purchased lines a `household.bootstrap` fetched from
 * `silpo_get_my_*_orders` (`FR-HH-002`, `ASM-01`, TDD §3, roadmap T1.6). Bootstrap
 * otherwise keeps only the aggregated `consumption_models.model` JSON; `receipt_lines` is
 * the replayable record that `buildConsumptionModel` and P1 pantry inference sit on.
 *
 * Deterministic, never the LLM (ADR-02). Pure helpers (`normalizeName` / `synonymIndex` /
 * `linkIngredientSlug` / `retailOrdersToRows`) are split from `saveReceiptLines(db, …)` so
 * they unit-test without a database — the `import-recipes.ts` / `consumption.ts` pattern.
 *
 * `ingredient_id` is a **best-effort** link: a normalized phrase match of the product name
 * against the `CanonicalIngredient` dictionary's `name_uk` + `synonyms`. Confident cases
 * only (meat / dairy / produce / staples); brand-heavy and prepared items stay `null` for
 * the T2.1 mapper to backfill.
 */

import type { RetailOrder } from "@navar/domain";
import { eq } from "drizzle-orm";

import { db, type Db } from "./client.js";
import { CANONICAL_INGREDIENTS } from "./data/canonical-ingredients.js";
import { canonicalIngredients, receiptLines } from "./schema.js";

const INSERT_CHUNK = 500;

/** numeric → fixed-dp string (drizzle `numeric` columns are string-mode). */
function num(v: number, dp: number): string {
  return v.toFixed(dp);
}

// ─── name normalisation + matching (pure) ─────────────────────────────────────

/**
 * Lowercase, drop every apostrophe variant, fold `ё→е`, keep only Unicode letters and
 * spaces (strips brand quotes «», digits, `%`, units, punctuation), collapse whitespace.
 * Applied to both the product name and every dictionary phrase so they compare like-for-like.
 */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[ʼ'`’‘]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SynonymEntry {
  phrase: string;
  slug: string;
}

/** Minimal dictionary shape `synonymIndex` needs (the full `CANONICAL_INGREDIENTS` fits). */
export interface DictEntry {
  slug: string;
  nameUk: string;
  synonyms?: readonly string[];
}

/**
 * Every `[name_uk, ...synonyms]` phrase, normalised and paired with its slug, **sorted
 * longest phrase first** so the most specific match wins (`молоко згущене` beats `молоко`).
 * Phrases shorter than 3 chars are dropped as too noisy.
 */
export function synonymIndex(
  entries: readonly DictEntry[] = CANONICAL_INGREDIENTS,
): SynonymEntry[] {
  const out: SynonymEntry[] = [];
  for (const e of entries) {
    const phrases = new Set(
      [e.nameUk, ...(e.synonyms ?? [])].map(normalizeName).filter((p) => p.length >= 3),
    );
    for (const phrase of phrases) out.push({ phrase, slug: e.slug });
  }
  return out.sort(
    (a, b) =>
      b.phrase.length - a.phrase.length ||
      a.slug.localeCompare(b.slug) ||
      a.phrase.localeCompare(b.phrase),
  );
}

/**
 * The canonical slug for a raw product name, or `null` when nothing matches confidently.
 * `index` must come from `synonymIndex` (pre-sorted); the first whitespace-bounded phrase
 * hit wins, so the result is deterministic.
 */
export function linkIngredientSlug(rawName: string, index: readonly SynonymEntry[]): string | null {
  const hay = ` ${normalizeName(rawName)} `;
  for (const { phrase, slug } of index) {
    if (hay.includes(` ${phrase} `)) return slug;
  }
  return null;
}

// ─── order → rows (pure) ─────────────────────────────────────────────────────

/** A `receipt_lines` row before the `ingredient_id` uuid is resolved from `ingredientSlug`. */
export interface ReceiptLineDraft {
  householdId: string;
  source: string;
  orderExternalId: string;
  purchasedAt: Date;
  rawName: string;
  aggKey: string;
  productRef: string | null;
  catalogSlug: string | null;
  quantity: string | null;
  unit: string | null;
  price: string | null;
  ingredientSlug: string | null;
}

/** Flatten `RetailOrder[]` (already PII-stripped by `silpo/parse.ts`) into draft rows. */
export function retailOrdersToRows(
  orders: readonly RetailOrder[],
  householdId: string,
  index: readonly SynonymEntry[],
): ReceiptLineDraft[] {
  const rows: ReceiptLineDraft[] = [];
  for (const o of orders) {
    const purchasedAt = new Date(o.createdAt);
    for (const l of o.lines) {
      rows.push({
        householdId,
        source: o.source,
        orderExternalId: o.externalId,
        purchasedAt,
        rawName: l.name,
        aggKey: l.key,
        productRef: l.catalogProductId,
        catalogSlug: l.slug,
        quantity: num(l.quantity, 3),
        unit: l.unit,
        price: num(l.unitPrice, 2),
        ingredientSlug: linkIngredientSlug(l.name, index),
      });
    }
  }
  return rows;
}

// ─── DB write ────────────────────────────────────────────────────────────────

/**
 * Replace a household's `receipt_lines` with the lines from `orders`. Delete-by-household +
 * bulk insert (mirrors the bootstrap's member rebuild) — idempotent, and a re-bootstrap
 * re-derives `ingredient_id`. Returns `{ total, linked }` for the bootstrap summary.
 */
export async function saveReceiptLines(
  database: Db = db,
  householdId: string,
  orders: readonly RetailOrder[],
): Promise<{ total: number; linked: number }> {
  const drafts = retailOrdersToRows(orders, householdId, synonymIndex());

  const idBySlug = new Map(
    (
      await database
        .select({ id: canonicalIngredients.id, slug: canonicalIngredients.slug })
        .from(canonicalIngredients)
    ).map((r) => [r.slug, r.id] as const),
  );

  const rows = drafts.map(({ ingredientSlug, ...rest }) => ({
    ...rest,
    ingredientId: ingredientSlug ? (idBySlug.get(ingredientSlug) ?? null) : null,
  }));

  await database.delete(receiptLines).where(eq(receiptLines.householdId, householdId));
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await database.insert(receiptLines).values(rows.slice(i, i + INSERT_CHUNK));
  }

  return { total: rows.length, linked: rows.filter((r) => r.ingredientId != null).length };
}
