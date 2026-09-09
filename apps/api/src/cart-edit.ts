/**
 * Cart-preview line edits (`cart.lineAlternatives` / `cart.setLineSku`). The Guest didn't
 * like the mapper's SKU for one ingredient and wants to pick a different product from the
 * branch's other options — or the fresh form of a protein isn't stocked. Pre-materialize
 * only (`guardEditable`): a materialised plan's `list_lines` must stay in lock-step with the
 * Silpo cart. Every candidate goes through the same T2.2 safety gate as the mapper
 * (fail-closed, ADR-05); the chosen SKU is re-checked before it is written.
 */

import { getPlanDetail, type ListLineSkuPatch, updateListLineSku } from "@navar/db";
import {
  type CartLineAlternative,
  type CartLineAlternativesResult,
  type CartSetLineSkuResult,
  hasShelfMarkdown,
  isPromoMatch,
  type ListLine,
  type ProductMatch,
} from "@navar/domain";
import {
  buildQuery,
  computePack,
  isNonFoodSku,
  type MapperDictEntry,
  parsePackSize,
  rankCandidates,
} from "@navar/mapper";
import { AuthRequiredError, NoCartError, type RetailProvider } from "@navar/retail";
import { hasHardExclusion } from "@navar/safety";

import { clearPreview } from "./cart.js";
import { loadExclusions, loadMapperDict, makeSkuSafety } from "./mapper.js";
import { withPersistedMcpTrace } from "./mcp-trace.js";

type RetailErrResult =
  | { status: "auth_required"; hint?: string }
  | { status: "no_cart"; hint?: string }
  | { status: "error"; message: string };

function retailError(err: unknown): RetailErrResult {
  if (err instanceof AuthRequiredError) return { status: "auth_required", hint: err.hint };
  if (err instanceof NoCartError) return { status: "no_cart", hint: err.message };
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

const MATERIALIZED_REASON =
  "Цей план уже зібрано в кошик Сільпо — товари в списку змінити не можна. Створіть новий план.";

interface Resolved {
  line: ListLine;
  entry: MapperDictEntry;
  /** Deduped, non-food-filtered, safety-passed candidates, best-first (R7 score). */
  ranked: ProductMatch[];
}

/**
 * Search the branch for SKUs that could fill one shopping-list line: `find_products_batch`
 * on the ingredient's head-noun query + `get_replacements` for the current SKU, deduped,
 * non-food-filtered, R7-ranked, then the T2.2 SKU gate on the top ~10.
 */
async function resolveLineCandidates(
  planId: string,
  householdId: string,
  slug: string,
  retail: RetailProvider,
): Promise<Resolved | { status: "not_found" } | RetailErrResult> {
  const plan = await getPlanDetail(planId, householdId);
  if (!plan) return { status: "not_found" };
  const line = plan.list.find((l) => l.slug === slug);
  if (!line) return { status: "not_found" };

  const dict = await loadMapperDict([slug]);
  const entry = dict.get(slug);
  if (!entry) return { status: "not_found" };

  try {
    const query = buildQuery(entry);
    const [search] = await retail.findProducts([query]);
    const fromSearch = search?.products ?? [];

    let fromReplacements: ProductMatch[] = [];
    if (line.productRef && line.companyId) {
      const [rep] = await retail.getReplacements([
        { productId: line.productRef, companyId: line.companyId },
      ]);
      fromReplacements = rep?.replacements ?? [];
    }

    const byId = new Map<string, ProductMatch>();
    for (const p of [...fromSearch, ...fromReplacements]) {
      if (p.productId && !byId.has(p.productId) && !isNonFoodSku(p.name)) byId.set(p.productId, p);
    }

    const exclusions = await loadExclusions(householdId);
    const skuSafety = hasHardExclusion(exclusions)
      ? makeSkuSafety(retail, exclusions, householdId)
      : null;

    const ranked = rankCandidates(entry, line.neededAmount, [...byId.values()]).map(
      (r) => r.candidate,
    );

    const safe: ProductMatch[] = [];
    for (const c of ranked.slice(0, 10)) {
      if (skuSafety) {
        const v = await skuSafety({
          slug,
          category: entry.category,
          ingredientAllergens: entry.allergens,
          chosen: c,
        });
        if (v.blocked) continue;
      }
      safe.push(c);
    }
    return { line, entry, ranked: safe };
  } catch (err) {
    return retailError(err);
  }
}

function toAlternative(
  m: ProductMatch,
  entry: MapperDictEntry,
  neededBase: number,
  currentRef: string | null,
): CartLineAlternative {
  const pack = computePack(neededBase, parsePackSize(m.packSize, entry.baseUnit), {
    weighted: m.weighted,
    step: m.step,
  });
  const packCount = Math.max(1, pack.packCount);
  // Weighted goods are priced kg × ₴/kg (MCP 1.109.8); packaged goods packs × ₴/pack.
  const billedQty = pack.quantityKg ?? packCount;
  return {
    productId: m.productId,
    companyId: m.companyId,
    branchId: m.branchId,
    name: m.name,
    priceUah: m.price,
    packSizeLabel: m.packSize,
    packCount,
    quantityKg: pack.quantityKg,
    lineTotalUah: Math.round(m.price * billedQty * 100) / 100,
    isPromo: isPromoMatch(m),
    inStock: m.inStock,
    weighted: m.weighted,
    isCurrent: m.productId === currentRef,
  };
}

/** `cart.lineAlternatives(planId, slug)` — the branch's other SKUs for one list line. */
export async function lineAlternatives(
  planId: string,
  householdId: string,
  slug: string,
  retail: RetailProvider,
): Promise<CartLineAlternativesResult> {
  return withPersistedMcpTrace("cart_line_alternatives", { planId, householdId }, async () => {
    const r = await resolveLineCandidates(planId, householdId, slug, retail);
    if ("status" in r) return r;

    const alts = r.ranked
      .map((m) => toAlternative(m, r.entry, r.line.neededAmount, r.line.productRef))
      .slice(0, 8);
    // current SKU first, then rank order
    alts.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
    return { status: "ok", slug, nameUk: r.line.nameUk, alternatives: alts };
  });
}

/** `cart.setLineSku(planId, slug, productId)` — swap one line's SKU to a Guest-picked one. */
export async function setLineSku(
  planId: string,
  householdId: string,
  slug: string,
  productId: string,
  retail: RetailProvider,
): Promise<CartSetLineSkuResult> {
  return withPersistedMcpTrace("cart_set_line_sku", { planId, householdId }, async () => {
    const plan = await getPlanDetail(planId, householdId);
    if (!plan) return { status: "not_found" };
    if (plan.status === "materialized" || plan.status === "checked_out" || plan.cartId != null) {
      return { status: "already_materialized", reason: MATERIALIZED_REASON };
    }

    const r = await resolveLineCandidates(planId, householdId, slug, retail);
    if ("status" in r) return r;

    const chosen = r.ranked.find((m) => m.productId === productId);
    if (!chosen) {
      return {
        status: "rejected",
        reason: "Цей товар більше недоступний або не пройшов перевірку безпеки.",
      };
    }

    const pack = computePack(
      r.line.neededAmount,
      parsePackSize(chosen.packSize, r.entry.baseUnit),
      {
        weighted: chosen.weighted,
        step: chosen.step,
      },
    );
    const patch: ListLineSkuPatch = {
      productRef: chosen.productId,
      externalProductId: chosen.externalProductId != null ? String(chosen.externalProductId) : null,
      companyId: chosen.companyId,
      branchId: chosen.branchId,
      productName: chosen.name,
      packSize: pack.packSize,
      packCount: Math.max(1, pack.packCount),
      quantityKg: pack.quantityKg,
      price: chosen.price,
      oldPrice: hasShelfMarkdown(chosen) ? chosen.oldPrice : null,
      isPromo: isPromoMatch(chosen),
      confidence: null,
      decision: "accepted",
      replacedFromName: null,
      needsConfirmation: false,
      outOfStock: !chosen.inStock,
      blockReason: null,
      userOverridden: true,
    };
    const changed = await updateListLineSku(planId, householdId, slug, patch);
    if (changed === 0) return { status: "not_found" };
    await clearPreview(planId);
    return { status: "ok" };
  });
}
