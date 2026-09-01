import { describe, expect, it } from "vitest";

import { NoCartError } from "../provider.js";
import { parseToolResult, toCartContext, toProductSearchResults } from "./parse.js";

describe("parseToolResult", () => {
  it("JSON-parses the text content", () => {
    expect(parseToolResult({ content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
  });
  it("returns {} for empty content", () => {
    expect(parseToolResult({ content: [] })).toEqual({});
  });
});

describe("toCartContext", () => {
  const cartById = {
    cart: { deliveryType: "DeliveryHome", shipments: [{ branchId: "branch-1" }] },
  };
  const slots = {
    slots: [
      { start: "s0", end: "e0", available: false },
      { start: "s1", end: "e1", available: true },
    ],
  };

  it("picks the first available slot, not the cart's stale one", () => {
    expect(toCartContext({ exists: true, shoppingCartId: "c1" }, cartById, slots)).toEqual({
      branchId: "branch-1",
      deliveryType: "DeliveryHome",
      timeslot: { start: "s1", end: "e1" },
    });
  });

  it("falls back to the first slot when none are available", () => {
    const ctx = toCartContext({ exists: true, shoppingCartId: "c1" }, cartById, {
      slots: [{ start: "s0", end: "e0", available: false }],
    });
    expect(ctx.timeslot).toEqual({ start: "s0", end: "e0" });
  });

  it("throws NoCartError when the guest has no cart", () => {
    expect(() => toCartContext({ exists: false }, {}, {})).toThrow(NoCartError);
  });
});

describe("toProductSearchResults", () => {
  it("maps and aligns to the input query order, trims fields", () => {
    const response = {
      queries: [
        {
          query: "Рис",
          products: [
            {
              id: "p1",
              externalProductId: 42,
              companyId: "co",
              branchId: "br",
              slug: "rys-1",
              name: "Рис Спар",
              price: 55,
              oldPrice: null,
              displayRatio: "800г",
              image: "http://img/1.png",
              stock: 3,
              available: true,
            },
          ],
        },
      ],
    };
    const out = toProductSearchResults(response, ["Куряче філе", "Рис"]);
    expect(out.map((r) => r.query)).toEqual(["Куряче філе", "Рис"]);
    expect(out[0]!.products).toEqual([]);
    expect(out[1]!.products[0]).toMatchObject({
      productId: "p1",
      packSize: "800г",
      inStock: true,
      price: 55,
    });
  });

  it("marks a zero-stock product out of stock", () => {
    const out = toProductSearchResults(
      { queries: [{ query: "q", products: [{ id: "x", available: true, stock: 0 }] }] },
      ["q"],
    );
    expect(out[0]!.products[0]!.inStock).toBe(false);
  });
});
