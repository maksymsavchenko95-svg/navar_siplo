/**
 * Keeping a materialized plan's `list_lines` in lock-step with the Silpo cart when the Guest
 * edits it after materialize (R4 — `docs/app-review-2026-09-08.md`).
 *
 * `addCartProducts` sets an absolute per-product quantity and never removes, so a plain
 * re-materialize would leave a swapped-out dish's SKUs in the cart. Every post-materialize
 * list edit therefore runs through `applyCartDelta`: it removes the SKUs the new list no
 * longer needs, re-asserts the ones whose quantity changed, then re-reads the cart
 * (`FR-CART-005`) so the caller returns live `validations[]` / totals / links.
 *
 * Ordering: callers apply the cart delta **before** persisting the DB edit — an MCP failure
 * then leaves nothing to reconcile.
 */

import { markPlanMaterialized } from "@navar/db";
import type { CartValidation, CartWriteItem, ListLine } from "@navar/domain";
import { AuthRequiredError, NoCartError, type RetailProvider } from "@navar/retail";

import { isAddableLine, toCartWriteItems } from "./cart.js";

export type RetailErrResult =
  | { status: "auth_required"; hint?: string }
  | { status: "no_cart"; hint?: string }
  | { status: "error"; message: string };

export function retailError(err: unknown): RetailErrResult {
  if (err instanceof AuthRequiredError) return { status: "auth_required", hint: err.hint };
  if (err instanceof NoCartError) return { status: "no_cart", hint: err.message };
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

export interface CartDelta {
  /** SKUs in the cart before the edit that the new list no longer buys. */
  removeProductIds: string[];
  /** SKUs to (re)assert at their new quantity — set-semantics, so a no-op is harmless. */
  addItems: CartWriteItem[];
}

const lineQty = (l: ListLine): number => l.quantityKg ?? l.packCount;

/**
 * The cart mutation that turns the cart backing `prevList` into one matching `nextList`:
 * `removeProductIds` = prev SKUs the next addable set drops; `addItems` = next addable lines
 * that are new or whose quantity moved (an unchanged line is a set-semantics no-op and left
 * out). A blocked / out-of-stock / unconfirmed next line is not addable, so its old SKU is
 * removed rather than re-asserted (`FR-SAFE-003`).
 */
export function diffCartLines(
  prevList: readonly ListLine[],
  nextList: readonly ListLine[],
): CartDelta {
  const prevQty = new Map<string, number>();
  for (const l of prevList) if (l.productRef) prevQty.set(l.productRef, lineQty(l));

  const addableNext = nextList.filter(isAddableLine);
  const nextRefs = new Set(
    addableNext.map((l) => l.productRef).filter((r): r is string => r != null),
  );
  const removeProductIds = [...prevQty.keys()].filter((r) => !nextRefs.has(r));
  const changed = addableNext.filter(
    (l) => l.productRef != null && prevQty.get(l.productRef) !== lineQty(l),
  );
  return { removeProductIds, addItems: toCartWriteItems(changed) };
}

export interface CartSyncOk {
  status: "ok";
  validations: CartValidation[];
  checkoutWebLink: string | null;
  checkoutMobileLink: string | null;
  cartTotalUah: number | null;
}

/**
 * Apply a delta to the live Silpo cart and re-read it. Caller must have checked the plan is
 * `materialized` (never `checked_out`). Best-effort `markPlanMaterialized` refresh keeps
 * `cartId` / `materializedAt` current.
 */
export async function applyCartDelta(
  planId: string,
  householdId: string,
  retail: RetailProvider,
  delta: CartDelta,
): Promise<CartSyncOk | RetailErrResult> {
  try {
    if (delta.removeProductIds.length > 0) await retail.removeCartProducts(delta.removeProductIds);
    if (delta.addItems.length > 0) await retail.addCartProducts(delta.addItems);
    const cart = await retail.getCart(); // FR-CART-005 — never assume the write took
    await markPlanMaterialized(planId, householdId, cart.shoppingCartId);
    return {
      status: "ok",
      validations: cart.validations,
      checkoutWebLink: cart.checkoutWebLink,
      checkoutMobileLink: cart.checkoutMobileLink,
      cartTotalUah: cart.totalAfterDiscountsUah ?? cart.totalUah,
    };
  } catch (err) {
    return retailError(err);
  }
}
