/**
 * Cart materialize + balabonuses (roadmap T3.1 / T3.2, TDD §7/§8, `FR-CART-001..007`,
 * ADR-07, `INT-MCP-003`).
 *
 * `cart.preview(planId)` shows exactly what a `cart.materialize` would add, partitioned so
 * the Guest sees what is blocked / needs confirmation / out of stock **before** anything is
 * written. `cart.materialize(planId)` is the single MCP write path: valid only after a
 * preview in the same session, idempotent on `planId` (Silpo cart writes are set-semantics),
 * never clearing an existing cart. It re-reads the cart afterwards, so `validations[]` /
 * totals / the checkout link are the live truth.
 *
 * Deterministic, never the LLM (ADR-02). The line-partitioning + write-item shaping are
 * pure helpers (unit-tested without a DB or the MCP); the orchestration takes a
 * `RetailProvider` so tests inject a mock.
 */

import { getPlanDetail, getPlanLineDays, markPlanMaterialized } from "@navar/db";
import type {
  CartApplyBonusResult,
  CartBonusOfferResult,
  CartCheckoutLinkResult,
  CartMaterializeResult,
  CartPreviewLine,
  CartPreviewResult,
  CartSkippedLine,
  CartValidation,
  CartView,
  CartWriteItem,
  IngredientCategory,
  ListLine,
} from "@navar/domain";
import { isWrongForm } from "@navar/mapper";
import { AuthRequiredError, NoCartError, type RetailProvider } from "@navar/retail";

import { loadMapperDict } from "./mapper.js";
import { withPersistedMcpTrace } from "./mcp-trace.js";
import { connection } from "./queue/connection.js";

// ── preview guard (materialize only after a preview in the same session) ──────

const PREVIEW_PREFIX = "navar:cart:preview:";
const PREVIEW_TTL_S = 900; // 15 min — a preview the Guest looked at is still "fresh"

/** Record that this session previewed this plan (`cart.preview` calls this). */
export async function armPreview(sessionId: string | null, planId: string): Promise<void> {
  if (!sessionId) return;
  await connection.set(`${PREVIEW_PREFIX}${sessionId}:${planId}`, "1", "EX", PREVIEW_TTL_S);
}

/**
 * Drop every session's preview of this plan (T4.2). The guard keys on plan **id**, which an
 * in-place edit does not change — so without this a Guest could preview a plan, edit it via
 * `plan.cheaper` / `plan.applyReplacement`, and then materialize something they never saw,
 * inside the 15-minute TTL.
 */
export async function clearPreview(planId: string): Promise<void> {
  const keys = await connection.keys(`${PREVIEW_PREFIX}*:${planId}`);
  if (keys.length > 0) await connection.del(...keys);
}

/** Did this session preview this plan? (`cart.materialize` checks this.) */
export async function previewArmed(sessionId: string | null, planId: string): Promise<boolean> {
  if (!sessionId) return false;
  return (await connection.get(`${PREVIEW_PREFIX}${sessionId}:${planId}`)) === "1";
}

// ── pure helpers ────────────────────────────────────────────────────────────

export interface PlanLinePartition {
  /** Has a safe, in-stock, confident SKU — add these. */
  addable: ListLine[];
  /** `confidence < 0.6` — added only if the Guest confirms (`FR-MAP` "never add silently"). */
  needsConfirmation: ListLine[];
  /** The SKU-level safety gate blocked this line — never added (`FR-SAFE-003`). */
  blocked: ListLine[];
  /** Chosen SKU is out of stock and the replacement funnel found nothing. */
  outOfStock: ListLine[];
  /** The mapper found no usable SKU. */
  unmatched: ListLine[];
}

/** Split a plan's shopping list into what can be added vs what needs the Guest's attention. */
export function partitionPlanLines(list: readonly ListLine[]): PlanLinePartition {
  const p: PlanLinePartition = {
    addable: [],
    needsConfirmation: [],
    blocked: [],
    outOfStock: [],
    unmatched: [],
  };
  for (const l of list) {
    if (l.decision === "blocked_unsafe" || l.blockReason != null) p.blocked.push(l);
    else if (l.productRef == null || l.companyId == null || l.branchId == null) p.unmatched.push(l);
    else if (l.outOfStock) p.outOfStock.push(l);
    // A SKU the Guest picked by hand on the preview (`cart.setLineSku`) is trusted — it
    // never routes back through `needs_confirmation`.
    else if (l.userOverridden) p.addable.push(l);
    else if (l.needsConfirmation || (l.confidence != null && l.confidence < 0.6))
      p.needsConfirmation.push(l);
    else p.addable.push(l);
  }
  return p;
}

/** `ListLine[]` → `silpo_add_or_update_cart_products` items. Drops rows missing an id / packs. */
export function toCartWriteItems(lines: readonly ListLine[]): CartWriteItem[] {
  return lines
    .filter((l) => l.productRef && l.companyId && l.branchId && (l.quantityKg ?? l.packCount) > 0)
    .map((l) => ({
      productId: l.productRef as string,
      companyId: l.companyId as string,
      branchId: l.branchId as string,
      // Weighted goods send kilograms (MCP 1.109.8: a multiple of the weighing step);
      // packaged goods send the whole-pack count.
      quantity: l.quantityKg ?? l.packCount,
    }));
}

function toPreviewLine(
  l: ListLine,
  ctx: { proteinUnavailable?: boolean; affectedDays?: number[] } = {},
): CartPreviewLine {
  return {
    slug: l.slug,
    nameUk: l.nameUk,
    productName: l.productName,
    productRef: l.productRef,
    quantity: l.packCount,
    quantityKg: l.quantityKg,
    priceUah: l.price,
    isPromo: l.isPromo,
    decision: l.decision,
    confidence: l.confidence,
    blockReason: l.blockReason,
    replacedFromName: l.replacedFromName,
    userOverridden: l.userOverridden,
    proteinUnavailable: ctx.proteinUnavailable ?? false,
    affectedDays: ctx.affectedDays ?? [],
  };
}

const PROTEIN_CATEGORIES = new Set<string>(["meat", "fish"]);

/**
 * A meat/fish line whose *fresh* form the branch cannot source — the cue for the
 * «Замінити страву» meal swap (C). Pure. `sku_unknown` / out of stock / a wrong-form pick
 * (canned, jerky) / a very weak match all count.
 */
export function proteinLineUnavailable(
  line: Pick<ListLine, "decision" | "outOfStock" | "confidence" | "productName">,
  category: string | undefined,
): boolean {
  if (!category || !PROTEIN_CATEGORIES.has(category)) return false;
  if (line.decision === "sku_unknown") return true;
  if (line.outOfStock) return true;
  if (line.productName && isWrongForm(category as IngredientCategory, line.productName))
    return true;
  if (line.confidence != null && line.confidence < 0.5) return true;
  return false;
}

/** A checkout-blocking `validations[]` entry → a short Guest-facing reason (non-medical). */
export function checkoutBlockReason(v: CartValidation): string {
  if (v.message === "order.cost.min") {
    const min = typeof v.context?.orderCostMin === "number" ? v.context.orderCostMin : null;
    return min != null
      ? `сума кошика нижча за мінімальну для замовлення — ${min} ₴`
      : "сума кошика нижча за мінімальну для замовлення";
  }
  if (v.message === "timeslot.not_found") return "потрібно обрати слот доставки";
  return v.message;
}

// ── NFR-DATA-003 — plan total vs actual cart total, ≤3% ──────────────────────

const DATA_TOLERANCE_PCT = 0.03;

/**
 * `|actual − estimate| / estimate`. `null` when there's nothing meaningful to compare
 * (either total missing, or a zero/degenerate estimate).
 */
export function totalsDiscrepancyPct(
  estimateUah: number | null,
  actualUah: number | null,
): number | null {
  if (estimateUah == null || actualUah == null || estimateUah <= 0) return null;
  return Math.abs(actualUah - estimateUah) / estimateUah;
}

/**
 * `NFR-DATA-003` — the plan's quoted total vs the real cart total after materialize, ≤3%.
 * `null` when not comparable (see `totalsDiscrepancyPct`). Meaningful on the golden path
 * (nothing `skipped`, cart was empty before the write); a large discrepancy when lines were
 * skipped or the cart already had other items in it is a signal about *what got skipped*,
 * not proof the mapper's pack-size cost math is wrong.
 */
export function withinDataTolerance(
  estimateUah: number | null,
  actualUah: number | null,
): boolean | null {
  const pct = totalsDiscrepancyPct(estimateUah, actualUah);
  return pct == null ? null : pct <= DATA_TOLERANCE_PCT;
}

// ── orchestration ───────────────────────────────────────────────────────────

/**
 * `AuthRequiredError` / `NoCartError` / anything else → the shared error members every
 * `cart.*` result union carries (assignable to each because they all include exactly these).
 */
type RetailErrResult =
  | { status: "auth_required"; hint?: string }
  | { status: "no_cart"; hint?: string }
  | { status: "error"; message: string };

function retailError(err: unknown): RetailErrResult {
  if (err instanceof AuthRequiredError) return { status: "auth_required", hint: err.hint };
  if (err instanceof NoCartError) return { status: "no_cart", hint: err.message };
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

/**
 * `cart.preview(planId)` — what `cart.materialize` would add, partitioned. Trusts the
 * stored `list_lines` prices for the estimate (the real total comes back from materialize);
 * reads the live cart only for its current line count + reachability. Writes nothing.
 */
export async function previewPlan(
  planId: string,
  householdId: string,
  retail: RetailProvider,
): Promise<CartPreviewResult> {
  return withPersistedMcpTrace("cart_preview", { planId, householdId }, () =>
    previewPlanInner(planId, householdId, retail),
  );
}

async function previewPlanInner(
  planId: string,
  householdId: string,
  retail: RetailProvider,
): Promise<CartPreviewResult> {
  const plan = await getPlanDetail(planId, householdId);
  if (!plan) return { status: "not_found" };

  let cart: CartView;
  try {
    cart = await retail.getCart();
  } catch (err) {
    return retailError(err);
  }

  const part = partitionPlanLines(plan.list);
  const estimatedAddUah =
    Math.round(
      part.addable.reduce((s, l) => s + (l.price ?? 0) * (l.quantityKg ?? l.packCount), 0) * 100,
    ) / 100;

  // C — flag meat/fish lines whose fresh form the branch can't source, with the days that
  // cook with them (for the «Замінити страву» action). Two cheap DB reads, no MCP.
  const dict = await loadMapperDict([...new Set(plan.list.map((l) => l.slug))]);
  const lineDays = await getPlanLineDays(planId, householdId);
  const ctxFor = (l: ListLine) =>
    proteinLineUnavailable(l, dict.get(l.slug)?.category)
      ? { proteinUnavailable: true, affectedDays: lineDays.get(l.slug) ?? [] }
      : {};

  return {
    status: "ok",
    planId,
    addable: part.addable.map((l) => toPreviewLine(l, ctxFor(l))),
    needsConfirmation: part.needsConfirmation.map((l) => toPreviewLine(l, ctxFor(l))),
    blocked: part.blocked.map((l) => toPreviewLine(l)),
    outOfStock: part.outOfStock.map((l) => toPreviewLine(l, ctxFor(l))),
    unmatched: part.unmatched.map((l) => toPreviewLine(l, ctxFor(l))),
    estimatedAddUah,
    currentCartLines: cart.lines.length,
    alreadyMaterialized: plan.status === "materialized" || plan.status === "checked_out",
  };
}

export interface MaterializeOpts {
  /** Slugs of `needsConfirmation` lines the Guest explicitly confirmed. */
  confirmedLines?: readonly string[];
  /** Slugs the Guest unchecked on the preview («у мене вдома є сіль») — not written. */
  excludeSlugs?: readonly string[];
  /** The caller's session id — checked against the preview guard. */
  sessionId?: string | null;
  /** Scripts / tests: bypass the "preview first" guard. */
  skipPreviewGuard?: boolean;
}

/**
 * `cart.materialize(planId)` — the single MCP write path. One `add_or_update_cart_products`
 * call (set-semantics → idempotent), then a mandatory re-read. Blocked / out-of-stock /
 * unmatched / unconfirmed lines are excluded and reported in `skipped` — never silently
 * dropped (`FR-SAFE-003`). Never removes or clears anything (`FR-CART-004`).
 */
export async function materializePlan(
  planId: string,
  householdId: string,
  retail: RetailProvider,
  opts: MaterializeOpts = {},
): Promise<CartMaterializeResult> {
  return withPersistedMcpTrace("cart_materialize", { planId, householdId }, () =>
    materializePlanInner(planId, householdId, retail, opts),
  );
}

async function materializePlanInner(
  planId: string,
  householdId: string,
  retail: RetailProvider,
  opts: MaterializeOpts,
): Promise<CartMaterializeResult> {
  if (!opts.skipPreviewGuard && !(await previewArmed(opts.sessionId ?? null, planId))) {
    return { status: "needs_preview" };
  }

  const plan = await getPlanDetail(planId, householdId);
  if (!plan) return { status: "not_found" };

  const part = partitionPlanLines(plan.list);
  const confirmed = new Set(opts.confirmedLines ?? []);
  const excluded = new Set(opts.excludeSlugs ?? []);
  const toAdd = [
    ...part.addable.filter((l) => !excluded.has(l.slug)),
    ...part.needsConfirmation.filter((l) => confirmed.has(l.slug) && !excluded.has(l.slug)),
  ];
  const items = toCartWriteItems(toAdd);

  const skipped: CartSkippedLine[] = [
    ...part.blocked.map((l) => ({
      slug: l.slug,
      nameUk: l.nameUk,
      reason: l.blockReason ?? "заблоковано запобіжником безпеки",
    })),
    ...part.outOfStock.map((l) => ({
      slug: l.slug,
      nameUk: l.nameUk,
      reason: "немає в наявності",
    })),
    ...part.unmatched.map((l) => ({
      slug: l.slug,
      nameUk: l.nameUk,
      reason: "не знайдено відповідного товару",
    })),
    ...part.needsConfirmation
      .filter((l) => !confirmed.has(l.slug) && !excluded.has(l.slug))
      .map((l) => ({ slug: l.slug, nameUk: l.nameUk, reason: "потрібне підтвердження Гостя" })),
    ...[...part.addable, ...part.needsConfirmation]
      .filter((l) => excluded.has(l.slug))
      .map((l) => ({ slug: l.slug, nameUk: l.nameUk, reason: "вилучено Гостем" })),
  ];

  try {
    if (items.length > 0) await retail.addCartProducts(items);
    const cart = await retail.getCart(); // mandatory re-read (FR-CART-005)
    if (items.length > 0) await markPlanMaterialized(planId, householdId, cart.shoppingCartId);

    const cartTotalUah = cart.totalAfterDiscountsUah ?? cart.totalUah;
    return {
      status: "ok",
      planId,
      addedCount: items.length,
      skipped,
      validations: cart.validations,
      checkoutWebLink: cart.checkoutWebLink,
      checkoutMobileLink: cart.checkoutMobileLink,
      cartTotalUah,
      planEstimateUah: plan.totalEstUah,
      totalsWithinTolerance: withinDataTolerance(plan.totalEstUah, cartTotalUah), // NFR-DATA-003
    };
  } catch (err) {
    return retailError(err);
  }
}

/** `cart.checkoutLink(planId)` — the handover links, or why they aren't available yet. */
export async function checkoutLink(
  planId: string,
  householdId: string,
  retail: RetailProvider,
): Promise<CartCheckoutLinkResult> {
  return withPersistedMcpTrace("cart_checkout_link", { planId, householdId }, () =>
    checkoutLinkInner(planId, householdId, retail),
  );
}

async function checkoutLinkInner(
  planId: string,
  householdId: string,
  retail: RetailProvider,
): Promise<CartCheckoutLinkResult> {
  const plan = await getPlanDetail(planId, householdId);
  if (!plan) return { status: "not_found" };
  try {
    const cart = await retail.getCart();
    if (cart.checkoutWebLink || cart.checkoutMobileLink) {
      return { status: "ok", webLink: cart.checkoutWebLink, mobileLink: cart.checkoutMobileLink };
    }
    const blocking = cart.validations.find((v) => v.level === "error");
    return {
      status: "unavailable",
      reason: blocking ? checkoutBlockReason(blocking) : "кошик ще не готовий до оформлення",
    };
  } catch (err) {
    return retailError(err);
  }
}

// ── balabonuses (T3.2, FR-CART-006) ─────────────────────────────────────────

/** `cart.offerBonus(planId)` — how many balabonuses the current cart has available. */
export async function offerBonus(
  planId: string,
  householdId: string,
  retail: RetailProvider,
): Promise<CartBonusOfferResult> {
  return withPersistedMcpTrace("cart_bonus", { planId, householdId }, () =>
    offerBonusInner(planId, householdId, retail),
  );
}

async function offerBonusInner(
  planId: string,
  householdId: string,
  retail: RetailProvider,
): Promise<CartBonusOfferResult> {
  const plan = await getPlanDetail(planId, householdId);
  if (!plan) return { status: "not_found" };
  try {
    const cart = await retail.getCart();
    const l = cart.loyalty;
    return {
      status: "ok",
      available: l?.bonusAvailable ?? 0,
      bonusTotal: l?.bonusTotal ?? 0,
      isEnabled: l?.isEnabled ?? false,
      alreadyApplied: l?.bonusRequested ?? null,
    };
  } catch (err) {
    return retailError(err);
  }
}

/**
 * `cart.applyBonus(planId, amount)` — apply `amount` balabonuses (or `null` to clear), only
 * on explicit Guest consent. Refuses if loyalty is disabled or the amount exceeds
 * `bonusAvailable`. Re-reads the cart afterwards.
 */
export async function applyBonus(
  planId: string,
  householdId: string,
  retail: RetailProvider,
  amount: number | null,
): Promise<CartApplyBonusResult> {
  return withPersistedMcpTrace("cart_bonus", { planId, householdId }, () =>
    applyBonusInner(planId, householdId, retail, amount),
  );
}

async function applyBonusInner(
  planId: string,
  householdId: string,
  retail: RetailProvider,
  amount: number | null,
): Promise<CartApplyBonusResult> {
  const plan = await getPlanDetail(planId, householdId);
  if (!plan) return { status: "not_found" };
  try {
    const before = await retail.getCart();
    if (!before.loyalty?.isEnabled) {
      return { status: "unavailable", reason: "балабонуси недоступні для цього кошика" };
    }
    if (amount != null && amount > before.loyalty.bonusAvailable) {
      return {
        status: "unavailable",
        reason: `доступно лише ${before.loyalty.bonusAvailable} балабонусів`,
      };
    }
    await retail.updateCartBonus(amount);
    const after = await retail.getCart();
    return {
      status: "ok",
      bonusApplied: after.loyalty?.bonusRequested ?? 0,
      cartTotalAfterDiscountsUah: after.totalAfterDiscountsUah ?? after.totalUah,
      checkoutWebLink: after.checkoutWebLink,
    };
  } catch (err) {
    return retailError(err);
  }
}
