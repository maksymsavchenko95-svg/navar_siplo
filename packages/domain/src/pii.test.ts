import { describe, expect, it } from "vitest";

import { redact } from "./pii.js";

describe("redact", () => {
  it("masks personal-data leaf values but keeps structure and non-PII values", () => {
    const input = {
      profile: {
        firstName: "Тарас",
        lastName: "Ш",
        phone: "+380...",
        gender: "male",
        status: "active",
      },
      addresses: [{ city: "Львів", street: "Січових", latitude: "49.8", longitude: "24.0" }],
    };
    expect(redact(input)).toEqual({
      profile: {
        firstName: "«redacted»",
        lastName: "«redacted»",
        phone: "«redacted»",
        gender: "male",
        status: "active",
      },
      addresses: [
        { city: "Львів", street: "«redacted»", latitude: "«redacted»", longitude: "«redacted»" },
      ],
    });
  });

  it("redacts a bare `name` on a person record (the family-member leak) but not on products", () => {
    const family = {
      members: [{ profileId: "p1", name: "Максим Савченко", itsMe: true }],
    };
    expect((redact(family) as typeof family).members[0]!.name).toBe("«redacted»");

    const product = { name: "Молоко Селянське 2.5%", price: 42 };
    expect(redact(product)).toEqual({ name: "Молоко Селянське 2.5%", price: 42 });
  });

  it("masks phone / email / loyalty card / address line anywhere in the tree", () => {
    const input = {
      order: {
        email: "a@b.com",
        phoneNumber: "0991112233",
        loyaltyCardNumber: "1234567890",
        addressLine: "вул. Хрещатик, 1",
        items: [{ name: "Хліб", qty: 2 }],
      },
    };
    expect(redact(input)).toEqual({
      order: {
        email: "«redacted»",
        phoneNumber: "«redacted»",
        loyaltyCardNumber: "«redacted»",
        addressLine: "«redacted»",
        items: [{ name: "Хліб", qty: 2 }],
      },
    });
  });

  it("redacts a child's name + date of birth but keeps id/slug (the children[] gap)", () => {
    const family = {
      children: [{ id: "c1", name: "Оля", slug: "olia", dateOfBirth: "2018-05-01" }],
    };
    expect(redact(family)).toEqual({
      children: [{ id: "c1", name: "«redacted»", slug: "olia", dateOfBirth: "«redacted»" }],
    });
  });

  it("masks floor / entrance / receiptUrl (the address + receipt gaps)", () => {
    const input = {
      addresses: [{ city: "Київ", street: "X", floor: "8", entrance: "3" }],
      orders: [{ receiptUrl: "https://receipt.silpo.elkasa.com.ua/abc", total: 100 }],
    };
    expect(redact(input)).toEqual({
      addresses: [
        { city: "Київ", street: "«redacted»", floor: "«redacted»", entrance: "«redacted»" },
      ],
      orders: [{ receiptUrl: "«redacted»", total: 100 }],
    });
  });

  it("does not treat a product line as a person record", () => {
    const line = { name: "Молоко Галичина 2.5%", price: 48.99, quantity: 1 };
    expect(redact(line)).toEqual(line);
  });

  it("passes primitives and nulls through untouched", () => {
    expect(redact(null)).toBeNull();
    expect(redact(7)).toBe(7);
    expect(redact("plain")).toBe("plain");
  });
});
