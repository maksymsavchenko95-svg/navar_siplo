/**
 * Pure helpers for the MCP audit scripts (`mcp-audit.ts`, `mcp-audit-cart.ts`).
 * Kept separate and dependency-free so they can be unit-tested (`audit-util.test.ts`).
 */

/** Object keys whose string/number values are personal data and must never be written out. */
export const PII_KEYS =
  /^(phone|phoneNumber|email|firstName|lastName|middleName|fullName|patronymic|birthday|birthDate|dateOfBirth|latitude|longitude|lat|lng|lon|cardNumber|loyaltyCardNumber|barcode|addressLine|street|houseNumber|building|flat|apartment|comment|recipientName|contactName)$/i;

const REDACTED = "«redacted»";

/**
 * Recursively replace personal-data leaf values with a placeholder, preserving structure.
 * Also redacts a bare `name` when the containing object looks like a person record
 * (profile / family member / recipient) — product/category `name`s are left intact.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const isPerson = "itsMe" in obj || "profileId" in obj || "profileCreatedAt" in obj;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const isPii = PII_KEYS.test(k) || (isPerson && /^name$/i.test(k));
        return [
          k,
          isPii && (typeof v === "string" || typeof v === "number") ? REDACTED : redact(v),
        ];
      }),
    );
  }
  return value;
}

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

/**
 * True when an error is the Silpo cart-write rate limit. The server sends this as a
 * plain-text message ("Rate limit exceeded"), NOT a JSON-RPC 429, so
 * `SilpoRetailProvider.withBackoff` (which matches `err.code === 429`) does not catch it.
 */
export function isRateLimit(err: unknown): boolean {
  const e = err as { code?: number; message?: string };
  if (e.code === 429) return true;
  return /rate limit/i.test(e.message ?? String(err));
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
