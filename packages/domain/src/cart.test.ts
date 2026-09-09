import { describe, expect, it } from "vitest";

import {
  cartApplyBonusResultSchema,
  cartDeliverySlotsResultSchema,
  cartLineAlternativesResultSchema,
  cartMaterializeResultSchema,
  cartPreviewLineSchema,
  cartPreviewResultSchema,
  cartSetDeliverySlotResultSchema,
  cartSetLineSkuResultSchema,
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

  it("cartPreviewLineSchema defaults the editable-preview fields", () => {
    const parsed = cartPreviewLineSchema.parse({
      slug: "beef",
      nameUk: "Яловичина",
      productName: "Яловичина тушкована",
      productRef: "p1",
      quantity: 1,
      priceUah: 129,
      isPromo: false,
      decision: "needs_confirmation",
      confidence: 0.4,
      blockReason: null,
      replacedFromName: null,
    });
    expect(parsed).toMatchObject({
      userOverridden: false,
      proteinUnavailable: false,
      affectedDays: [],
    });
    expect(
      cartPreviewLineSchema.parse({
        slug: "beef",
        nameUk: "Яловичина",
        productName: null,
        productRef: null,
        quantity: 0,
        priceUah: null,
        isPromo: false,
        decision: "sku_unknown",
        confidence: null,
        blockReason: null,
        replacedFromName: null,
        userOverridden: true,
        proteinUnavailable: true,
        affectedDays: [1, 3],
      }).affectedDays,
    ).toEqual([1, 3]);
  });

  it("cartLineAlternativesResultSchema + cartSetLineSkuResultSchema round-trip", () => {
    const alts = {
      status: "ok" as const,
      slug: "beef",
      nameUk: "Яловичина",
      alternatives: [
        {
          productId: "p2",
          companyId: "co",
          branchId: "br",
          name: "Яловичина лопатка",
          priceUah: 210,
          packSizeLabel: "1кг",
          packCount: 1,
          lineTotalUah: 210,
          isPromo: false,
          inStock: true,
          weighted: true,
          isCurrent: false,
        },
      ],
    };
    expect(cartLineAlternativesResultSchema.parse(alts)).toEqual(alts);
    for (const r of [
      { status: "ok" },
      { status: "already_materialized", reason: "x" },
      { status: "rejected", reason: "y" },
    ]) {
      expect(cartSetLineSkuResultSchema.parse(r)).toEqual(r);
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
      totalsWithinTolerance: true,
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

  it("cartDeliverySlotsResultSchema round-trips ok with slots + a nullable selected", () => {
    const ok = {
      status: "ok" as const,
      slots: [
        {
          start: "2026-09-05T10:00:00Z",
          end: "2026-09-05T12:00:00Z",
          available: true,
          minOrderCostUah: 550,
        },
        {
          start: "2026-09-05T12:00:00Z",
          end: "2026-09-05T14:00:00Z",
          available: false,
          minOrderCostUah: null,
        },
      ],
      selected: null,
    };
    expect(cartDeliverySlotsResultSchema.parse(ok)).toEqual(ok);
  });

  it("cartSetDeliverySlotResultSchema accepts ok + rejected", () => {
    expect(
      cartSetDeliverySlotResultSchema.parse({
        status: "ok",
        selected: { start: "s", end: "e" },
        validations: [],
        checkoutWebLink: null,
        checkoutMobileLink: null,
      }).status,
    ).toBe("ok");
    expect(
      cartSetDeliverySlotResultSchema.parse({ status: "rejected", reason: "слот зайнято" }).status,
    ).toBe("rejected");
  });
});
