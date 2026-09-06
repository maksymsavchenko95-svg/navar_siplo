import type { ProductMatch, SpecialPrice } from "./retail.js";

/**
 * Promo vocabulary (T4.1, `FR-PLAN-004`, `AC-P0-04`) — the single source of truth for
 * "is this SKU on promo" and "what does it actually cost".
 *
 * Lives in `@navar/domain` rather than `@navar/mapper` because both the mapper (SKU
 * choice) and the planner (budget arithmetic) need it, and ADR-01 makes domain the only
 * package both may import. Deterministic code owns every number here — never the LLM
 * (ADR-02).
 *
 * Silpo exposes **two independent** discount mechanics on a search hit, and the M0 audit
 * found them non-overlapping (16 products carried `oldPrice`, 5 carried `specialPrices`,
 * zero carried both — `docs/mcp-audit-results.md`):
 *
 * 1. `oldPrice > price` — a straight shelf markdown, applies to a single unit.
 * 2. `specialPrices: [{ price, count, type: "from" }]` — a **multi-buy** tier ("2+ at 114 ₴
 *    each" against a 144 ₴ shelf price). This is the «Гуртом дешевше» campaign, and it only
 *    pays out once you actually buy `count` units.
 */

/** A multi-buy tier resolved from `specialPrices` — `price` each, once you buy `minCount`. */
export interface PromoTier {
  minCount: number;
  price: number;
}

/**
 * The cheapest usable multi-buy tier on a SKU, or `null`. Only `type: "from"` tiers are
 * honoured — that is the "buy N or more" semantic; any other type is ignored rather than
 * guessed at. A tier that is not actually cheaper than the shelf price is not a promo.
 */
export function promoTier(
  m: Pick<ProductMatch, "price"> & { specialPrices?: readonly SpecialPrice[] },
): PromoTier | null {
  const usable = (m.specialPrices ?? []).filter(
    (t) => t.type === "from" && t.count >= 1 && t.price > 0 && t.price < m.price,
  );
  if (usable.length === 0) return null;
  // Cheapest wins; ties break on the lower threshold so the discount is easier to reach.
  const best = usable.reduce((a, b) =>
    b.price < a.price || (b.price === a.price && b.count < a.count) ? b : a,
  );
  return { minCount: best.count, price: best.price };
}

/**
 * `true` when the SKU carries any real discount — a shelf markdown **or** a multi-buy tier.
 *
 * This is the single predicate; it replaces the two copies of `oldPrice > price` that used
 * to live in the mapper (`map.ts` / `score.ts`) and silently ignored multi-buy entirely.
 * Note this answers "is a discount available", which is the right question when *choosing*
 * a SKU. Whether the discount is actually *collected* depends on how many packs the plan
 * buys — that is `effectiveUnitPrice` / `tierApplies`, and it is what the promo share must
 * be built on so the Guest-facing number stays honest.
 */
export function isPromoMatch(
  m: Pick<ProductMatch, "price" | "oldPrice"> & { specialPrices?: readonly SpecialPrice[] },
): boolean {
  return hasShelfMarkdown(m) || promoTier(m) != null;
}

/**
 * A straight shelf markdown — `oldPrice > price`, collected on a single unit with no
 * threshold. Distinct from a multi-buy tier, and a SKU may in principle carry both, so the
 * solver tracks them separately: markdown counts unconditionally, a tier only once reached.
 */
export function hasShelfMarkdown(m: Pick<ProductMatch, "price" | "oldPrice">): boolean {
  return m.oldPrice != null && m.oldPrice > m.price;
}

/** Whether buying `packs` units actually reaches the tier's threshold. */
export function tierApplies(tier: PromoTier | null | undefined, packs: number): boolean {
  return tier != null && packs >= tier.minCount;
}

/**
 * What one unit really costs when buying `packs` of them: the tier price once the
 * threshold is met, otherwise the shelf price. Pure and deterministic — this is budget
 * arithmetic (ADR-02).
 */
export function effectiveUnitPrice(
  price: number,
  tier: PromoTier | null | undefined,
  packs: number,
): number {
  return tierApplies(tier, packs) ? tier!.price : price;
}
