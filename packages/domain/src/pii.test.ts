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

  it("passes primitives and nulls through untouched", () => {
    expect(redact(null)).toBeNull();
    expect(redact(7)).toBe(7);
    expect(redact("plain")).toBe("plain");
  });
});
