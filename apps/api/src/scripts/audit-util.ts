/**
 * Pure helpers for the MCP audit scripts (`mcp-audit.ts`, `mcp-audit-cart.ts`).
 * Kept separate and dependency-free so they can be unit-tested (`audit-util.test.ts`).
 */

// PII redaction lives in `@navar/domain` (`INT-LLM-004`) — the audit scripts and the LLM
// harness share one implementation. Re-exported here so callers keep importing from one place.
export { PII_KEYS, redact } from "@navar/domain";

// The Silpo cart-write rate-limit check lives in `@navar/retail` (the write path uses it
// too). Re-exported so the audit scripts keep importing from one place.
export { isRateLimit } from "@navar/retail";

/** Structural sketch of a value: keys + leaf types; arrays collapse to `[shape, "×N"]`. */
export function shape(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(value)) {
    return value.length ? [shape(value[0], depth + 1), `×${value.length}`] : [];
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shape(v, depth + 1)]),
    );
  }
  return value === null ? "null" : typeof value;
}

/** Compact one-line rendering of an unknown error (JSON-RPC code if present, else message). */
export function errMsg(err: unknown): string {
  const e = err as { code?: number; message?: string };
  return e.code ? `[${e.code}] ${e.message ?? ""}` : (e.message ?? String(err));
}

export interface CartLine {
  productId?: string;
  name?: string;
  quantity?: number;
}
export interface CartView {
  loyalty?: unknown;
  cart?: {
    shipments?: { products?: CartLine[] }[];
    calculation?: { total?: number; validations?: unknown[] };
    checkoutWebLink?: string;
    checkoutMobileLink?: string;
  };
}

/** All product lines across every shipment of a `silpo_get_shopping_cart_by_id` response. */
export function cartLines(v: CartView): CartLine[] {
  return (v.cart?.shipments ?? []).flatMap((s) => s.products ?? []);
}

/** Audit summary of a cart view — note `loyalty` is top-level, `validations` under `calculation`. */
export function summariseCart(v: CartView, label: string): Record<string, unknown> {
  const ls = cartLines(v);
  return {
    label,
    lineCount: ls.length,
    lines: ls.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity })),
    total: v.cart?.calculation?.total,
    validations: v.cart?.calculation?.validations ?? null,
    hasCheckoutWebLink: Boolean(v.cart?.checkoutWebLink),
    checkoutWebLink: v.cart?.checkoutWebLink ?? null,
    checkoutMobileLink: v.cart?.checkoutMobileLink ?? null,
    loyalty: v.loyalty ?? null,
  };
}
