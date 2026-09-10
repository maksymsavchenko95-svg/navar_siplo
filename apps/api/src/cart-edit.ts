/**
 * Cart line edits + recovery: `cart.lineAlternatives` / `cart.setLineSku` (swap one line's
 * SKU), `cart.reduceLine` (cut a shorted line to available stock), `cart.checkoutInStock`
 * (drop every sold-out line and check out the rest). SKU swaps go through the same T2.2
 * safety gate as the mapper (fail-closed, ADR-05) and are re-checked before the write. A
 * materialised plan's `list_lines` are kept in lock-step with the Silpo cart via
 * `applyCartDelta`; a `checked_out` plan is frozen. No cart is ever cleared (`FR-CART-004`).
 */

import {
  getPlanDetail,
  type ListLineSkuPatch,
  markListLinesOutOfStock,
  updateListLineQuantity,
  updateListLineSku,
} from "@navar/db";
import {
  type CartCheckoutInStockResult,
  type CartLineAlternative,
  type CartLineAlternativesResult,
  type CartReduceLineResult,
  type CartSetLineSkuResult,
  type CartWriteItem,
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

import { checkoutBlocker, clearPreview, STOCK_SHORTAGE_CODES } from "./cart.js";
import { applyCartDelta } from "./cart-resync.js";
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

const CHECKED_OUT_REASON =
  "Замовлення в «Сільпо» вже оформлене — список цього плану змінити не можна. Створіть новий план.";

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
    // A placed order is frozen; a materialized-but-not-checked-out plan can still be edited,
    // as long as the swap is also written through to the Silpo cart (R4).
    if (plan.status === "checked_out") {
      return { status: "already_materialized", reason: CHECKED_OUT_REASON };
    }
    const isMaterialized = plan.status === "materialized" || plan.cartId != null;

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
    // Re-sync the Silpo cart before touching the DB, so an MCP failure leaves nothing to
    // reconcile: drop the old SKU, assert the new one at the line's quantity.
    if (isMaterialized) {
      const oldRef = r.line.productRef;
      const newItem: CartWriteItem = {
        productId: chosen.productId,
        companyId: chosen.companyId,
        branchId: chosen.branchId,
        quantity: pack.quantityKg ?? Math.max(1, pack.packCount),
      };
      const sync = await applyCartDelta(planId, householdId, retail, {
        removeProductIds: oldRef && oldRef !== chosen.productId ? [oldRef] : [],
        addItems: [newItem],
      });
      if (sync.status !== "ok") return sync;
    }

    const changed = await updateListLineSku(planId, householdId, slug, patch);
    if (changed === 0) return { status: "not_found" };
    await clearPreview(planId);
    return { status: "ok" };
  });
}

/**
 * `cart.reduceLine(planId, slug, toQuantity)` — cut a materialized line down to the stock the
 * branch can fulfil (R4 genuine-shortage recovery). Writes the lower quantity to the Silpo
 * cart (set-semantics — no remove), syncs the `list_lines` row, re-reads. The pre-materialize
 * preview flow owns quantities, so a plan with no cart yet returns `not_materialized`.
 */
export async function reduceLine(
  planId: string,
  householdId: string,
  slug: string,
  toQuantity: number,
  retail: RetailProvider,
): Promise<CartReduceLineResult> {
  return withPersistedMcpTrace("cart_reduce_line", { planId, householdId }, async () => {
    const plan = await getPlanDetail(planId, householdId);
    if (!plan) return { status: "not_found" };
    if (plan.status !== "materialized") {
      return {
        status: "not_materialized",
        reason:
          plan.status === "checked_out"
            ? "Замовлення вже оформлене — кількість змінюйте в «Сільпо»."
            : "Кошик ще не зібрано — змініть кількість на кроці перегляду.",
      };
    }

    const line = plan.list.find((l) => l.slug === slug);
    if (!line) return { status: "not_found" };
    if (line.productRef == null || line.companyId == null || line.branchId == null) {
      return { status: "rejected", reason: "Цей товар не прив'язаний до кошика." };
    }

    const weighted = line.quantityKg != null;
    const current = weighted ? line.quantityKg! : line.packCount;
    const target = weighted
      ? Math.min(current, Math.max(0, toQuantity))
      : Math.max(1, Math.min(current, Math.floor(toQuantity)));

    // Nothing to cut (stock already covers the line, or a degenerate target) — just re-read.
    const delta =
      target > 0 && target < current
        ? {
            removeProductIds: [],
            addItems: [
              {
                productId: line.productRef,
                companyId: line.companyId,
                branchId: line.branchId,
                quantity: target,
              } satisfies CartWriteItem,
            ],
          }
        : { removeProductIds: [], addItems: [] };

    const sync = await applyCartDelta(planId, householdId, retail, delta);
    if (sync.status !== "ok") return sync;

    if (delta.addItems.length > 0) {
      await updateListLineQuantity(planId, householdId, slug, {
        packCount: weighted ? line.packCount : target,
        quantityKg: weighted ? target : null,
      });
    }
    return {
      status: "ok",
      validations: sync.validations,
      checkoutWebLink: sync.checkoutWebLink,
      checkoutMobileLink: sync.checkoutMobileLink,
      cartTotalUah: sync.cartTotalUah,
    };
  });
}

/**
 * `cart.checkoutInStock(planId)` — the Guest chose to order the in-stock remainder. Drops
 * every `product.offer.stock.*` line from the Silpo cart (consented, set-semantic, never a
 * clear — `FR-CART-004`), re-reads, and hands back the checkout link. `list_lines` for the
 * dropped SKUs are flagged out of stock so the same plan's later screens stay consistent.
 * `blockReason` is non-null when the reduced cart still can't check out (e.g. now below
 * `order.cost.min`); `nothing_to_drop` when no line is actually short.
 */
export async function checkoutInStock(
  planId: string,
  householdId: string,
  retail: RetailProvider,
): Promise<CartCheckoutInStockResult> {
  return withPersistedMcpTrace("cart_checkout_in_stock", { planId, householdId }, async () => {
    const plan = await getPlanDetail(planId, householdId);
    if (!plan) return { status: "not_found" };

    try {
      const cart = await retail.getCart();
      const shortedIds = [
        ...new Set(
          cart.validations
            .filter((v) => v.level === "error" && STOCK_SHORTAGE_CODES.has(v.message))
            .map((v) => String(v.context?.productId ?? v.context?.productOfferId ?? ""))
            .filter((id) => id !== ""),
        ),
      ];
      if (shortedIds.length === 0) return { status: "nothing_to_drop" };

      const sync = await applyCartDelta(planId, householdId, retail, {
        removeProductIds: shortedIds,
        addItems: [],
      });
      if (sync.status !== "ok") return sync;

      await markListLinesOutOfStock(planId, householdId, shortedIds);

      // Name the lines we can map; an unmatched `productId` (R0 — the list can hold SKUs no
      // plan line owns) is still removed but not listed by a raw id.
      const droppedNames = shortedIds
        .map((id) => plan.list.find((x) => x.productRef === id || x.externalProductId === id))
        .filter((l): l is NonNullable<typeof l> => l != null)
        .map((l) => l.productName ?? l.nameUk);

      // Removing products never touches the delivery echo — reuse the pre-write `delivery`
      // with the re-read validations to name any remaining blocker (FR-CART-005).
      const ready = sync.checkoutWebLink != null || sync.checkoutMobileLink != null;
      return {
        status: "ok",
        droppedCount: shortedIds.length,
        droppedNames,
        checkoutWebLink: sync.checkoutWebLink,
        checkoutMobileLink: sync.checkoutMobileLink,
        cartTotalUah: sync.cartTotalUah,
        blockReason: ready ? null : checkoutBlocker({ ...cart, validations: sync.validations }),
      };
    } catch (err) {
      return retailError(err);
    }
  });
}
