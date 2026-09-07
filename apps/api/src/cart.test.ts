import type { CartView, ListLine, PlanDetail } from "@navar/domain";
import { AuthRequiredError, NoCartError, type RetailProvider } from "@navar/retail";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mock the DB + Redis so the orchestration runs without infra ──────────────

const getPlanDetail = vi.fn<(id: string, hh: string) => Promise<PlanDetail | null>>();
const markPlanMaterialized = vi.fn(async () => 1);
vi.mock("@navar/db", () => ({
  getPlanDetail: (...a: [string, string]) => getPlanDetail(...a),
  markPlanMaterialized: (...a: unknown[]) => markPlanMaterialized(...(a as [])),
}));

const redis = new Map<string, string>();
vi.mock("./queue/connection.js", () => ({
  connection: {
    get: async (k: string) => redis.get(k) ?? null,
    set: async (k: string, v: string) => void redis.set(k, v),
  },
}));

const {
  applyBonus,
  materializePlan,
  offerBonus,
  partitionPlanLines,
  previewPlan,
  toCartWriteItems,
  totalsDiscrepancyPct,
  withinDataTolerance,
} = await import("./cart.js");

// ── fixtures ────────────────────────────────────────────────────────────────

const line = (over: Partial<ListLine> & Pick<ListLine, "slug">): ListLine => ({
  ingredientId: `id-${over.slug}`,
  nameUk: over.slug,
  neededAmount: 300,
  unit: "g",
  productRef: `${over.slug}-sku`,
  externalProductId: null,
  companyId: "co",
  branchId: "br",
  productName: `${over.slug} SKU`,
  packSize: 400,
  packCount: 1,
  price: 40,
  oldPrice: null,
  isPromo: false,
  confidence: 0.9,
  decision: "accepted",
  needsConfirmation: false,
  outOfStock: false,
  blockReason: null,
  replacedFromName: null,
  userOverridden: false,
  ...over,
});

const planDetail = (list: ListLine[], over: Partial<PlanDetail> = {}): PlanDetail => ({
  id: "11111111-1111-4111-8111-111111111111",
  goal: "routine",
  seed: 1,
  days: 5,
  budgetUah: 2500,
  status: "draft",
  totalEstUah: 800,
  promoSharePct: 30,
  savingsUah: 0,
  estimatedCostUah: 0,
  unpricedLineCount: 0,
  proteinFloorMet: true,
  kcalCorridorMet: true,
  explanation: null,
  explanationSource: null,
  cartId: null,
  materializedAt: null,
  createdAt: "2026-09-04T00:00:00.000Z",
  items: [],
  list,
  ...over,
});

const cartView = (over: Partial<CartView> = {}): CartView => ({
  shoppingCartId: "cart-1",
  lines: [],
  totalUah: 812,
  totalAfterDiscountsUah: 790,
  validations: [],
  loyalty: { bonusAvailable: 25, bonusTotal: 25, bonusRequested: null, isEnabled: true },
  checkoutWebLink: "https://silpo.ua/checkout",
  checkoutMobileLink: null,
  delivery: null,
  ...over,
});

/** A `RetailProvider` mock that records writes — the four cart methods `cart.ts` uses. */
function fakeRetail(over: Partial<Record<string, unknown>> = {}) {
  const m = {
    getCart: vi.fn(async () => cartView()),
    addCartProducts: vi.fn(async () => ({ success: true, summary: "ok", products: [] })),
    removeCartProducts: vi.fn(async () => ({ success: true, summary: "ok", products: [] })),
    updateCartBonus: vi.fn(async () => ({ success: true, summary: "ok", products: [] })),
    ...over,
  };
  return m as unknown as typeof m & RetailProvider;
}

beforeEach(() => {
  vi.clearAllMocks();
  redis.clear();
});

// ── pure helpers ────────────────────────────────────────────────────────────

describe("partitionPlanLines", () => {
  it("routes each line to exactly one bucket, safety first", () => {
    const part = partitionPlanLines([
      line({ slug: "ok" }),
      line({ slug: "blocked", decision: "blocked_unsafe", blockReason: "алерген: молоко" }),
      line({ slug: "blocked2", blockReason: "склад невідомий" }), // blockReason alone → blocked
      line({ slug: "unmatched", productRef: null }),
      line({ slug: "oos", outOfStock: true }),
      line({ slug: "lowconf", confidence: 0.4 }),
      line({ slug: "needsconf", needsConfirmation: true }),
    ]);
    expect(part.addable.map((l) => l.slug)).toEqual(["ok"]);
    expect(part.blocked.map((l) => l.slug)).toEqual(["blocked", "blocked2"]);
    expect(part.unmatched.map((l) => l.slug)).toEqual(["unmatched"]);
    expect(part.outOfStock.map((l) => l.slug)).toEqual(["oos"]);
    expect(part.needsConfirmation.map((l) => l.slug)).toEqual(["lowconf", "needsconf"]);
  });
});

describe("toCartWriteItems", () => {
  it("shapes items and drops rows missing an id or packs", () => {
    expect(
      toCartWriteItems([
        line({ slug: "a" }),
        line({ slug: "b", companyId: null }),
        line({ slug: "c", packCount: 0 }),
      ]),
    ).toEqual([{ productId: "a-sku", companyId: "co", branchId: "br", quantity: 1 }]);
  });
});

// ── previewPlan ─────────────────────────────────────────────────────────────

describe("previewPlan", () => {
  it("partitions, estimates the addable cost, reports current cart size", async () => {
    getPlanDetail.mockResolvedValue(
      planDetail([line({ slug: "a", price: 40, packCount: 2 }), line({ slug: "b", price: 10 })]),
    );
    const retail = fakeRetail({
      getCart: vi.fn(async () =>
        cartView({ lines: [{ productId: "x", name: "x", quantity: 1, price: 5 }] }),
      ),
    });
    const r = await previewPlan("p1", "hh", retail);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.estimatedAddUah).toBe(90); // 40*2 + 10
    expect(r.currentCartLines).toBe(1);
    expect(r.addable).toHaveLength(2);
  });

  it("surfaces not_found / auth_required / no_cart", async () => {
    getPlanDetail.mockResolvedValue(null);
    expect((await previewPlan("p1", "hh", fakeRetail())).status).toBe("not_found");

    getPlanDetail.mockResolvedValue(planDetail([]));
    const auth = fakeRetail({
      getCart: vi.fn(async () => {
        throw new AuthRequiredError("reconnect");
      }),
    });
    expect((await previewPlan("p1", "hh", auth)).status).toBe("auth_required");

    const noCart = fakeRetail({
      getCart: vi.fn(async () => {
        throw new NoCartError();
      }),
    });
    expect((await previewPlan("p1", "hh", noCart)).status).toBe("no_cart");
  });
});

// ── materializePlan ─────────────────────────────────────────────────────────

describe("materializePlan", () => {
  it("needs a preview in the same session first", async () => {
    getPlanDetail.mockResolvedValue(planDetail([line({ slug: "a" })]));
    const r = await materializePlan("p1", "hh", fakeRetail(), { sessionId: "s1" });
    expect(r.status).toBe("needs_preview");
  });

  it("adds addable lines in one call, marks the plan, returns live validations + total", async () => {
    getPlanDetail.mockResolvedValue(planDetail([line({ slug: "a" }), line({ slug: "b" })]));
    const retail = fakeRetail({
      getCart: vi.fn(async () =>
        cartView({
          validations: [
            {
              level: "error",
              type: "order",
              message: "order.cost.min",
              context: { orderCostMin: 799 },
            },
          ],
          totalAfterDiscountsUah: 812.4,
        }),
      ),
    });
    const r = await materializePlan("p1", "hh", retail, { skipPreviewGuard: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.addedCount).toBe(2);
    expect(retail.addCartProducts).toHaveBeenCalledTimes(1);
    expect(retail.addCartProducts).toHaveBeenCalledWith([
      { productId: "a-sku", companyId: "co", branchId: "br", quantity: 1 },
      { productId: "b-sku", companyId: "co", branchId: "br", quantity: 1 },
    ]);
    expect(markPlanMaterialized).toHaveBeenCalledWith("p1", "hh", "cart-1");
    expect(r.validations[0]!.message).toBe("order.cost.min");
    expect(r.cartTotalUah).toBe(812.4);
    expect(r.planEstimateUah).toBe(800);
    expect(r.totalsWithinTolerance).toBe(true); // |812.4-800|/800 ≈ 1.55% ≤ 3% (NFR-DATA-003)
  });

  it("flags NFR-DATA-003 when the cart total drifts from the plan estimate beyond 3%", async () => {
    getPlanDetail.mockResolvedValue(planDetail([line({ slug: "a" })]));
    const retail = fakeRetail({
      getCart: vi.fn(async () => cartView({ totalAfterDiscountsUah: 900 })), // |900-800|/800 = 12.5%
    });
    const r = await materializePlan("p1", "hh", retail, { skipPreviewGuard: true });
    expect(r.status === "ok" && r.totalsWithinTolerance).toBe(false);
  });

  it("is idempotent — a second materialize adds the same set, never removes/clears", async () => {
    getPlanDetail.mockResolvedValue(planDetail([line({ slug: "a" })]));
    const retail = fakeRetail();
    await materializePlan("p1", "hh", retail, { skipPreviewGuard: true });
    await materializePlan("p1", "hh", retail, { skipPreviewGuard: true });
    expect(retail.addCartProducts).toHaveBeenCalledTimes(2);
    expect(retail.addCartProducts.mock.calls[0]).toEqual(retail.addCartProducts.mock.calls[1]);
    expect(retail.removeCartProducts).not.toHaveBeenCalled();
  });

  it("fail-closed: a blocked line is excluded from the write and reported in skipped", async () => {
    getPlanDetail.mockResolvedValue(
      planDetail([
        line({ slug: "safe" }),
        line({ slug: "milk", decision: "blocked_unsafe", blockReason: "алерген: молоко" }),
      ]),
    );
    const retail = fakeRetail();
    const r = await materializePlan("p1", "hh", retail, { skipPreviewGuard: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(retail.addCartProducts).toHaveBeenCalledWith([
      { productId: "safe-sku", companyId: "co", branchId: "br", quantity: 1 },
    ]);
    expect(r.skipped).toContainEqual({ slug: "milk", nameUk: "milk", reason: "алерген: молоко" });
  });

  it("low-confidence lines are added only when confirmed", async () => {
    getPlanDetail.mockResolvedValue(planDetail([line({ slug: "cream", confidence: 0.4 })]));
    const retail = fakeRetail();

    const without = await materializePlan("p1", "hh", retail, { skipPreviewGuard: true });
    expect(without.status === "ok" && without.addedCount).toBe(0);
    expect(retail.addCartProducts).not.toHaveBeenCalled();
    expect(without.status === "ok" && without.skipped[0]!.reason).toContain("підтвердження");

    const withConfirm = await materializePlan("p1", "hh", retail, {
      skipPreviewGuard: true,
      confirmedLines: ["cream"],
    });
    expect(withConfirm.status === "ok" && withConfirm.addedCount).toBe(1);
  });

  it("honours the preview guard once armed (via cart.preview)", async () => {
    getPlanDetail.mockResolvedValue(planDetail([line({ slug: "a" })]));
    const retail = fakeRetail();
    await previewPlan("p1", "hh", retail); // arms nothing itself…
    // the router arms the guard; simulate that:
    redis.set("navar:cart:preview:s1:p1", "1");
    const r = await materializePlan("p1", "hh", retail, { sessionId: "s1" });
    expect(r.status).toBe("ok");
  });
});

// ── balabonuses (T3.2) ──────────────────────────────────────────────────────

describe("offerBonus / applyBonus", () => {
  it("offerBonus reports availability from the cart's loyalty block", async () => {
    getPlanDetail.mockResolvedValue(planDetail([]));
    const r = await offerBonus("p1", "hh", fakeRetail());
    expect(r).toMatchObject({ status: "ok", available: 25, isEnabled: true, alreadyApplied: null });
  });

  it("applyBonus refuses an amount over what's available, applies otherwise", async () => {
    getPlanDetail.mockResolvedValue(planDetail([]));
    const retail = fakeRetail();

    const tooMuch = await applyBonus("p1", "hh", retail, 999);
    expect(tooMuch.status).toBe("unavailable");
    expect(retail.updateCartBonus).not.toHaveBeenCalled();

    const ok = await applyBonus("p1", "hh", retail, 25);
    expect(retail.updateCartBonus).toHaveBeenCalledWith(25);
    expect(ok.status).toBe("ok");
  });

  it("applyBonus refuses when loyalty is disabled", async () => {
    getPlanDetail.mockResolvedValue(planDetail([]));
    const retail = fakeRetail({
      getCart: vi.fn(async () =>
        cartView({
          loyalty: { bonusAvailable: 0, bonusTotal: 0, bonusRequested: null, isEnabled: false },
        }),
      ),
    });
    expect((await applyBonus("p1", "hh", retail, 10)).status).toBe("unavailable");
  });
});

// ── NFR-DATA-003 — plan total vs actual cart total, ≤3% ──────────────────────

describe("totalsDiscrepancyPct / withinDataTolerance", () => {
  it("is null when either total is missing or the estimate is zero/negative", () => {
    expect(totalsDiscrepancyPct(null, 100)).toBeNull();
    expect(totalsDiscrepancyPct(100, null)).toBeNull();
    expect(totalsDiscrepancyPct(0, 100)).toBeNull();
    expect(withinDataTolerance(null, 100)).toBeNull();
  });

  it("is true exactly at the 3% boundary, false just over it", () => {
    expect(totalsDiscrepancyPct(1000, 1030)).toBeCloseTo(0.03, 10);
    expect(withinDataTolerance(1000, 1030)).toBe(true);
    expect(withinDataTolerance(1000, 1030.01)).toBe(false);
    expect(withinDataTolerance(1000, 970)).toBe(true); // symmetric — under too
    expect(withinDataTolerance(1000, 969.99)).toBe(false);
  });
});
