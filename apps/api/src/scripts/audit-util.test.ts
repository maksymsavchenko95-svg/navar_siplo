import { describe, expect, it } from "vitest";

import {
  type CartView,
  cartLines,
  errMsg,
  isRateLimit,
  shape,
  summariseCart,
} from "./audit-util.js";

// `redact` / `PII_KEYS` moved to `@navar/domain` — covered by `packages/domain/src/pii.test.ts`.

describe("shape", () => {
  it("collapses arrays to [elementShape, '×N'] and reports leaf types", () => {
    expect(shape({ a: 1, b: "x", c: [{ d: true }, { d: false }], e: null })).toEqual({
      a: "number",
      b: "string",
      c: [{ d: "boolean" }, "×2"],
      e: "null",
    });
  });

  it("stops recursing past the depth cap", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 10; i++) deep = { n: deep };
    expect(JSON.stringify(shape(deep))).toContain('"…"');
  });
});

describe("isRateLimit", () => {
  it("matches the plain-text cart-write rate limit (no JSON-RPC 429 code)", () => {
    expect(
      isRateLimit(
        new Error("Error in add-or-update-cart-products: Rate limit exceeded. Please wait"),
      ),
    ).toBe(true);
  });
  it("matches a JSON-RPC 429", () => {
    expect(isRateLimit({ code: 429, message: "Too Many Requests" })).toBe(true);
  });
  it("is false for unrelated errors", () => {
    expect(isRateLimit(new Error("Resource not found"))).toBe(false);
    expect(isRateLimit({ code: 403 })).toBe(false);
  });
});

describe("errMsg", () => {
  it("prefixes a JSON-RPC code when present, else uses the message", () => {
    expect(errMsg({ code: 401, message: "invalid_token" })).toBe("[401] invalid_token");
    expect(errMsg(new Error("boom"))).toBe("boom");
  });
});

describe("cartLines / summariseCart", () => {
  const view: CartView = {
    loyalty: { bonusAvailable: 22.53, isEnabled: true },
    cart: {
      shipments: [
        { products: [{ productId: "a", name: "Сіль", quantity: 1 }] },
        { products: [{ productId: "b", quantity: 2 }] },
      ],
      calculation: { total: 195.97, validations: [{ level: "error", message: "order.cost.min" }] },
    },
  };

  it("flattens product lines across every shipment", () => {
    expect(cartLines(view).map((l) => l.productId)).toEqual(["a", "b"]);
    expect(cartLines({})).toEqual([]);
  });

  it("reads validations from calculation and loyalty from the top level", () => {
    const s = summariseCart(view, "t");
    expect(s.lineCount).toBe(2);
    expect(s.total).toBe(195.97);
    expect(s.validations).toEqual([{ level: "error", message: "order.cost.min" }]);
    expect(s.loyalty).toEqual({ bonusAvailable: 22.53, isEnabled: true });
    expect(s.hasCheckoutWebLink).toBe(false);
  });
});
