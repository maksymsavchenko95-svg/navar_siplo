import { describe, expect, it } from "vitest";

import {
  cartApplyBonusResultSchema,
  cartMaterializeResultSchema,
  cartPreviewResultSchema,
  cartViewSchema,
  cartWriteItemSchema,
} from "./cart.js";

describe("cartViewSchema", () => {
  const good = {
    shoppingCartId: "c1",
    lines: [{ productId: "p1", name: "Молоко", quantity: 1, price: 42.5 }],
    totalUah: 196,
    totalAfterDiscountsUah: 180,
    validations: [
      { level: "error", type: "order", message: "order.cost.min", context: { orderCostMin: 799 } },
      { level: "info", type: "order", message: "order.payment_types.disabled" },
    ],
    loyalty: { bonusAvailable: 22.53, bonusTotal: 22.53, bonusRequested: null, isEnabled: true },
    checkoutWebLink: null,
    checkoutMobileLink: null,
    delivery: {
      deliveryType: "DeliveryHome",
      timeslot: { start: "s", end: "e" },
      address: { addressType: "home", latitude: "50", longitude: "30" },
      shipments: [{ companyId: "co", branchId: "b" }],
    },
  };

  it("accepts a realistic cart view", () => {
    expect(cartViewSchema.parse(good)).toMatchObject({ shoppingCartId: "c1" });
  });

  it("rejects an unknown validation level", () => {
    expect(() =>
      cartViewSchema.parse({
        ...good,
        validations: [{ level: "warning", type: "x", message: "y" }],
      }),
    ).toThrow();
  });

  it("allows a null loyalty block and null delivery", () => {
    expect(cartViewSchema.parse({ ...good, loyalty: null, delivery: null }).loyalty).toBeNull();
  });
});

describe("cartWriteItemSchema", () => {
  it("requires a positive quantity and all three ids", () => {
    expect(() =>
      cartWriteItemSchema.parse({ productId: "p", companyId: "c", branchId: "b", quantity: 0 }),
    ).toThrow();
    expect(
      cartWriteItemSchema.parse({ productId: "p", companyId: "c", branchId: "b", quantity: 2 }),
    ).toEqual({ productId: "p", companyId: "c", branchId: "b", quantity: 2 });
  });
});

describe("cart result unions (discriminated on status)", () => {
  it("cartPreviewResultSchema round-trips ok + not_found + no_cart", () => {
    for (const r of [
      {
        status: "ok",
        planId: "11111111-1111-4111-8111-111111111111",
        addable: [],
        needsConfirmation: [],
        blocked: [],
        outOfStock: [],
        unmatched: [],
        estimatedAddUah: 0,
        currentCartLines: 3,
        alreadyMaterialized: false,
      },
      { status: "not_found" },
      { status: "no_cart", hint: "open the app" },
    ]) {
      expect(cartPreviewResultSchema.parse(r)).toEqual(r);
    }
  });

  it("cartMaterializeResultSchema carries needs_preview + skipped lines", () => {
    expect(cartMaterializeResultSchema.parse({ status: "needs_preview" })).toEqual({
      status: "needs_preview",
    });
    const ok = {
      status: "ok",
      planId: "11111111-1111-4111-8111-111111111111",
      addedCount: 4,
      skipped: [{ slug: "cream", nameUk: "Вершки", reason: "потрібне підтвердження Гостя" }],
      validations: [],
      checkoutWebLink: null,
      checkoutMobileLink: null,
      cartTotalUah: 812.4,
      planEstimateUah: 800,
    };
    expect(cartMaterializeResultSchema.parse(ok)).toEqual(ok);
  });

  it("cartApplyBonusResultSchema accepts ok + unavailable", () => {
    expect(
      cartApplyBonusResultSchema.parse({
        status: "ok",
        bonusApplied: 22.53,
        cartTotalAfterDiscountsUah: 158,
        checkoutWebLink: "https://silpo/checkout",
      }).status,
    ).toBe("ok");
    expect(
      cartApplyBonusResultSchema.parse({ status: "unavailable", reason: "вимкнено" }).status,
    ).toBe("unavailable");
  });
});
