import type { CartValidation } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { distinctValidationMessages, humanValidation } from "./cart-validation";

const v = (message: string, over: Partial<CartValidation> = {}): CartValidation => ({
  level: "error",
  type: "order",
  message,
  ...over,
});

describe("humanValidation", () => {
  it("uses the minimum from context for order.cost.min", () => {
    expect(humanValidation(v("order.cost.min", { context: { orderCostMin: 799 } }))).toContain(
      "799",
    );
  });

  it("maps known codes to sentences", () => {
    expect(humanValidation(v("timeslot.not_found"))).toMatch(/слот/i);
    expect(humanValidation(v("product.offer.stock.max"))).toMatch(/кількості/i);
    expect(humanValidation(v("product.offer.stock.min"))).toMatch(/кількості/i);
    expect(humanValidation(v("order.payment_types.disabled"))).toMatch(/оплати/i);
  });

  it("never echoes a raw dot-namespaced code back", () => {
    const r = humanValidation(v("brand.new.unmapped.code"));
    expect(r).not.toContain("brand.new.unmapped.code");
    expect(r).not.toContain(".");
  });
});

describe("distinctValidationMessages", () => {
  it("collapses the many identical stock errors to one message", () => {
    const validations = [
      v("product.offer.stock.max", { context: { productId: "a", stock: 0 } }),
      v("product.offer.stock.max", { context: { productId: "b", stock: 0 } }),
      v("product.offer.stock.max", { context: { productId: "c", stock: 0 } }),
    ];
    expect(distinctValidationMessages(validations, "error")).toEqual([
      "Деяких товарів немає в потрібній кількості",
    ]);
  });

  it("keeps distinct reasons, filters by level, preserves order", () => {
    const validations = [
      v("order.cost.min", { context: { orderCostMin: 500 } }),
      v("product.offer.stock.max"),
      v("timeslot.not_found", { level: "info" }),
    ];
    const errors = distinctValidationMessages(validations, "error");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/нижча за мінімальну.*500/);
    expect(errors[1]).toBe("Деяких товарів немає в потрібній кількості");
    expect(distinctValidationMessages(validations, "info")).toEqual([
      "Оберіть слот доставки нижче",
    ]);
  });

  it("returns [] when nothing matches the level", () => {
    expect(distinctValidationMessages([], "error")).toEqual([]);
  });
});
