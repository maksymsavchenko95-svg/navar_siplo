import { describe, expect, it } from "vitest";

import { NoCartError } from "../provider.js";
import {
  parseAddresses,
  parseFamily,
  parseFavorites,
  parseOrders,
  parseProfile,
  parseRestrictionsRaw,
  parseToolResult,
  toCartContext,
  toProductSearchResults,
} from "./parse.js";

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

// ─── Household mappers (T1.4) — shapes from docs/mcp-audit-raw/block1,3-*.json ──

describe("parseProfile", () => {
  it("keeps id/gender, derives birthYear, drops name/phone/email", () => {
    expect(
      parseProfile({
        profile: {
          id: "00012288-4f5e-47d6-b62f-cb8c1822dcf2",
          firstName: "«redacted»",
          phone: "«redacted»",
          email: "«redacted»",
          birthday: "1988-07-14",
          gender: "male",
          status: "Active",
        },
      }),
    ).toEqual({
      silpoProfileId: "00012288-4f5e-47d6-b62f-cb8c1822dcf2",
      gender: "male",
      birthYear: 1988,
    });
  });

  it("returns null birthYear when the date is redacted / missing", () => {
    expect(parseProfile({ profile: { id: "x", birthday: "«redacted»" } }).birthYear).toBeNull();
    expect(parseProfile({}).silpoProfileId).toBe("");
  });
});

describe("parseFamily", () => {
  const now = new Date("2026-09-02T00:00:00Z");

  it("counts adults and pets, computes child ages, drops names", () => {
    const fam = parseFamily(
      {
        members: [
          { profileId: "p1", name: "«redacted»", phone: "«redacted»", itsMe: true },
          { profileId: "p2", name: "«redacted»" },
        ],
        children: [{ id: "c1", name: "«redacted»", dateOfBirth: "2019-03-01" }],
        pets: [{ id: "d1" }, { id: "d2" }],
      },
      now,
    );
    expect(fam).toEqual({
      adultCount: 2,
      childAgeYears: [7],
      petCount: 2,
      itsMeProfileId: "p1",
    });
  });

  it("defaults to one adult and no children on an empty family", () => {
    expect(parseFamily({ members: [], children: [], pets: [] }, now)).toEqual({
      adultCount: 1,
      childAgeYears: [],
      petCount: 0,
      itsMeProfileId: null,
    });
  });
});

describe("parseRestrictionsRaw", () => {
  it("returns [] for the empty test-account response", () => {
    expect(
      parseRestrictionsRaw({
        success: true,
        summary: "No food restrictions set",
        restrictions: [],
      }),
    ).toEqual([]);
  });

  it("flattens slug + label fields to free text (synthetic populated shape)", () => {
    expect(
      parseRestrictionsRaw({
        restrictions: [
          { slug: "no-lactose", name: "Без лактози" },
          { slug: "veg", title: "Vegetarian", description: "no meat" },
          { slug: "bare-slug" },
        ],
      }),
    ).toEqual([
      { slug: "no-lactose", text: "Без лактози" },
      { slug: "veg", text: "Vegetarian — no meat" },
      { slug: "bare-slug", text: "bare-slug" },
    ]);
  });
});

describe("parseAddresses", () => {
  it("keeps only id/tag/city, drops street/building/floor/entrance/geo/comment", () => {
    expect(
      parseAddresses({
        addresses: [
          {
            id: "a1",
            tag: null,
            city: "Харків",
            street: "«redacted»",
            building: "«redacted»",
            floor: "8",
            entrance: "3",
            latitude: "«redacted»",
            comment: "«redacted»",
          },
        ],
      }),
    ).toEqual([{ id: "a1", tag: null, city: "Харків" }]);
  });
});

describe("parseOrders", () => {
  it("maps an online order (tz-aware date, name key, empty older orders)", () => {
    const out = parseOrders({
      orders: [
        {
          orderId: "o1",
          createdAt: "2026-02-02T12:07:14+00:00",
          amount: 1114.12,
          discount: 61.29,
          products: [{ id: "x", name: "Молоко", price: 40, quantity: 2, subtotal: 80 }],
        },
        { orderId: "o2", createdAt: "2024-01-01T00:00:00+00:00", amount: 50, products: [] },
      ],
    });
    expect(out[0]).toMatchObject({
      source: "online",
      externalId: "o1",
      createdAt: "2026-02-02T12:07:14.000Z",
      total: 1114.12,
      discount: 61.29,
    });
    expect(out[0]!.lines[0]).toEqual({
      key: "name:Молоко",
      name: "Молоко",
      slug: null,
      unitPrice: 40,
      quantity: 2,
      lineTotal: 80,
      unit: null,
      catalogProductId: null,
    });
    expect(out[1]!.lines).toEqual([]);
  });

  it("maps an offline order (naive date → UTC, void quantity, catalogProduct null)", () => {
    const out = parseOrders({
      orders: [
        {
          filId: 4227,
          createdAt: "2026-08-17T20:11:07",
          sumReg: 479.55,
          sumDiscount: 81,
          receiptUrl: "https://receipt.silpo.elkasa.com.ua/abc",
          products: [
            {
              lagerId: 51604,
              name: "Персик",
              unit: "кг",
              quantity: 0.618,
              price: 89.99,
              catalogProduct: { id: "cp1", slug: "persyk-51604" },
            },
            {
              lagerId: 999,
              name: "Void",
              unit: "шт",
              quantity: -1,
              price: 10,
              catalogProduct: null,
            },
          ],
        },
      ],
    });
    expect(out[0]).toMatchObject({
      source: "offline",
      externalId: "fil:4227:2026-08-17T20:11:07",
      createdAt: "2026-08-17T20:11:07.000Z",
      total: 479.55,
      discount: 81,
    });
    // receiptUrl must not appear anywhere in the mapped result
    expect(JSON.stringify(out)).not.toContain("elkasa");
    expect(out[0]!.lines[0]).toMatchObject({
      key: "persyk-51604",
      slug: "persyk-51604",
      catalogProductId: "cp1",
    });
    expect(out[0]!.lines[1]).toMatchObject({
      key: "lager:999",
      slug: null,
      quantity: -1,
      lineTotal: -10,
    });
  });
});

describe("parseFavorites", () => {
  it("maps fields and handles an unresolvable favorite (price 0, branchId null)", () => {
    expect(
      parseFavorites({
        products: [
          {
            id: "f1",
            slug: "s1",
            name: "Молоко",
            price: 42,
            available: true,
            companyId: "co",
            branchId: "b1",
          },
          { id: "f2", slug: "s2", name: "Рідкість", price: 0, available: false, branchId: null },
        ],
      }),
    ).toEqual([
      {
        productId: "f1",
        slug: "s1",
        name: "Молоко",
        price: 42,
        available: true,
        companyId: "co",
        branchId: "b1",
      },
      {
        productId: "f2",
        slug: "s2",
        name: "Рідкість",
        price: 0,
        available: false,
        companyId: "",
        branchId: null,
      },
    ]);
  });
});
