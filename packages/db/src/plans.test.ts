import type { MapperResult, SkuMatch } from "@navar/domain";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "./client.js";
import { importCanonicalIngredients } from "./import-ingredients.js";
import {
  getPlanDetail,
  markPlanMaterialized,
  replacePlanRows,
  savePlan,
  setPlanExplanation,
  toPlanRows,
  updatePlanDay,
  type ToPlanRowsInput,
} from "./plans.js";
import { canonicalIngredients, households, listLines, planItems, plans } from "./schema.js";

// ─── fixtures ────────────────────────────────────────────────────────────────

const skuMatch = (over: Partial<SkuMatch> & Pick<SkuMatch, "slug">): SkuMatch => ({
  ingredientNameUk: over.slug,
  query: over.slug,
  neededAmount: 300,
  neededUnit: "g",
  match: {
    productId: `${over.slug}-sku`,
    externalProductId: 12345,
    companyId: "co",
    branchId: "br-1",
    slug: `${over.slug}-sku`,
    name: `${over.slug} SKU`,
    price: 42,
    oldPrice: null,
    packSize: "400г",
    imageUrl: null,
    inStock: true,
    weighted: false,
    step: null,
    specialPrices: [],
  },
  score: 0.8,
  confidence: 0.8,
  decision: "accepted",
  needsConfirmation: false,
  packCount: 1,
  packSize: 400,
  surplusAmount: 100,
  isPromo: false,
  promoTier: null,
  candidatesConsidered: 3,
  rerankSource: null,
  safetyChecked: false,
  blockReason: null,
  outOfStock: false,
  ...over,
});

const mapperResult = (matches: SkuMatch[]): MapperResult => ({
  branchId: "br-1",
  consolidated: [],
  matches,
  stats: {
    total: matches.length,
    matched: matches.length,
    needsConfirmation: 0,
    noMatch: 0,
    blocked: 0,
  },
});

const baseInput = (over: Partial<ToPlanRowsInput> = {}): ToPlanRowsInput => ({
  householdId: "hh-1",
  goal: "routine",
  seed: 7,
  days: 2,
  budgetUah: 1000,
  servings: 3,
  picks: [
    {
      day: 1,
      recipeId: "r-1",
      slug: "borshch",
      titleUk: "Борщ",
      portionScale: 1,
      costUah: 120,
      promoShareUah: 40,
      macrosPerServing: { kcal: 520, protein: 28, fat: 18, carbs: 60 },
    },
    {
      day: 2,
      recipeId: "r-2",
      slug: "plov",
      titleUk: "Плов",
      portionScale: 1,
      costUah: 150,
      promoShareUah: 0,
      macrosPerServing: { kcal: 700, protein: 35, fat: 22, carbs: 80 },
    },
  ],
  totals: {
    costUah: 270,
    promoSharePct: 14.81,
    estimatedCostUah: 0,
    unpricedLineCount: 0,
    proteinFloorMet: true,
    kcalCorridorMet: false,
  },
  mapper: mapperResult([
    skuMatch({ slug: "beet" }),
    skuMatch({ slug: "rice" }),
    skuMatch({ slug: "unused" }), // not in any chosen recipe → must be filtered out
  ]),
  idBySlug: new Map([
    ["beet", "id-beet"],
    ["rice", "id-rice"],
    ["unused", "id-unused"],
  ]),
  recipeSlugIngredients: new Map([
    ["borshch", ["beet"]],
    ["plov", ["rice"]],
  ]),
  ...over,
});

// ─── pure ────────────────────────────────────────────────────────────────────

describe("toPlanRows", () => {
  it("maps picks to plan_items with snapshots", () => {
    const { plan, items } = toPlanRows(baseInput());
    expect(plan.totalEstUah).toBe("270.00");
    expect(plan.promoShare).toBe("0.148");
    expect(plan.kcalCorridorMet).toBe(false);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      dayIndex: 1,
      recipeId: "r-1",
      slug: "borshch",
      titleUk: "Борщ",
      servings: 3,
      costUah: "120.00",
      kcalServing: "520.00",
    });
  });

  it("keeps only the chosen recipes' ingredients in list_lines, sorted by slug", () => {
    const { lines } = toPlanRows(baseInput());
    expect(lines.map((l) => l.slug)).toEqual(["beet", "rice"]); // "unused" dropped
    expect(lines[0]).toMatchObject({
      ingredientId: "id-beet",
      productRef: "beet-sku",
      companyId: "co",
      price: "42.00",
      packCount: 1,
      isPromo: false,
    });
  });

  it("drops a line whose ingredient slug has no id, and carries blocked / out-of-stock flags", () => {
    const input = baseInput({
      mapper: mapperResult([
        skuMatch({ slug: "beet", match: null, decision: "blocked_unsafe", blockReason: "алерген" }),
        skuMatch({
          slug: "rice",
          match: null,
          decision: "no_match",
          outOfStock: true,
          needsConfirmation: true,
        }),
      ]),
      idBySlug: new Map([["rice", "id-rice"]]), // beet missing
    });
    const { lines } = toPlanRows(input);
    expect(lines.map((l) => l.slug)).toEqual(["rice"]);
    expect(lines[0]).toMatchObject({
      decision: "no_match",
      outOfStock: true,
      needsConfirmation: true,
      price: null,
    });
  });

  it("propagates F3/F4 totals", () => {
    const { plan } = toPlanRows(
      baseInput({
        totals: {
          costUah: 500,
          promoSharePct: 0,
          estimatedCostUah: 90,
          unpricedLineCount: 3,
          proteinFloorMet: false,
          kcalCorridorMet: true,
        },
      }),
    );
    expect(plan.estimatedCostUah).toBe("90.00");
    expect(plan.unpricedLineCount).toBe(3);
    expect(plan.proteinFloorMet).toBe(false);
  });

  it("is deterministic", () => {
    expect(toPlanRows(baseInput())).toEqual(toPlanRows(baseInput()));
  });
});

// ─── integration ─────────────────────────────────────────────────────────────

describe.skipIf(!process.env.DATABASE_URL)("savePlan / getPlanDetail (integration)", () => {
  let householdId: string;
  let ingredientIds: Map<string, string>;

  afterEach(async () => {
    if (householdId) await db.delete(households).where(eq(households.id, householdId));
  });
  afterAll(closeDb);

  async function setup() {
    await importCanonicalIngredients();
    const [hh] = await db.insert(households).values({ goal: "routine" }).returning();
    householdId = hh!.id;
    const rows = await db
      .select({ id: canonicalIngredients.id, slug: canonicalIngredients.slug })
      .from(canonicalIngredients);
    ingredientIds = new Map(rows.map((r) => [r.slug, r.id]));
  }

  const SLUGS = ["carrot", "onion", "potato"] as const;

  function rowsFor() {
    return toPlanRows(
      baseInput({
        householdId,
        recipeSlugIngredients: new Map([
          ["borshch", ["carrot", "onion"]],
          ["plov", ["potato"]],
        ]),
        picks: [
          {
            day: 1,
            recipeId: "",
            slug: "borshch",
            titleUk: "Борщ",
            portionScale: 1,
            costUah: 120,
            promoShareUah: 40,
            macrosPerServing: { kcal: 520, protein: 28, fat: 18, carbs: 60 },
          },
          {
            day: 2,
            recipeId: "",
            slug: "plov",
            titleUk: "Плов",
            portionScale: 0.8,
            costUah: 150,
            promoShareUah: 0,
            macrosPerServing: { kcal: 700, protein: 35, fat: 22, carbs: 80 },
          },
        ],
        mapper: mapperResult(SLUGS.map((s) => skuMatch({ slug: s }))),
        idBySlug: new Map(SLUGS.map((s) => [s, ingredientIds.get(s)!])),
      }),
    );
  }

  it("round-trips a plan + items + list, and cascades on delete", async () => {
    await setup();
    const planId = await savePlan(rowsFor());
    await setPlanExplanation(planId, householdId, "Тестове пояснення.");

    const detail = await getPlanDetail(planId, householdId);
    expect(detail).not.toBeNull();
    expect(detail!.items.map((i) => i.dayIndex)).toEqual([1, 2]);
    expect(detail!.list.map((l) => l.slug)).toEqual(["carrot", "onion", "potato"]);
    expect(detail!.explanation).toBe("Тестове пояснення.");
    expect(detail!.promoSharePct).toBeCloseTo(14.81, 1);

    // wrong household → not found
    expect(await getPlanDetail(planId, "00000000-0000-0000-0000-000000000000")).toBeNull();

    await db.delete(plans).where(eq(plans.id, planId));
    expect(await db.$count(planItems, eq(planItems.planId, planId))).toBe(0);
    expect(await db.$count(listLines, eq(listLines.planId, planId))).toBe(0);
  });

  it("updatePlanDay rewrites one day and leaves the others untouched (T4.2)", async () => {
    await setup();
    const planId = await savePlan(rowsFor());
    const before = await getPlanDetail(planId, householdId);
    const day2Before = before!.items.find((i) => i.dayIndex === 2)!;

    // wrong household → 0 rows, nothing changes
    expect(
      await updatePlanDay(planId, "00000000-0000-0000-0000-000000000000", 1, {
        slug: "hacked",
        titleUk: "Hacked",
        servings: 3,
        costUah: "1.00",
        promoShareUah: "0.00",
      }),
    ).toBe(0);
    expect((await getPlanDetail(planId, householdId))!.items[0]!.slug).toBe("borshch");

    expect(
      await updatePlanDay(planId, householdId, 1, {
        slug: "kulish",
        titleUk: "Куліш",
        servings: 3,
        portionScale: "1.20",
        costUah: "310.00",
        promoShareUah: "50.00",
      }),
    ).toBe(1);

    const after = await getPlanDetail(planId, householdId);
    const day1 = after!.items.find((i) => i.dayIndex === 1)!;
    expect(day1.slug).toBe("kulish");
    expect(day1.portionScale).toBeCloseTo(1.2, 2);
    // the untouched day is byte-identical
    expect(after!.items.find((i) => i.dayIndex === 2)).toEqual(day2Before);
  });

  it("replacePlanRows swaps the whole body without orphaning list lines (T4.2)", async () => {
    await setup();
    const planId = await savePlan(rowsFor());
    const linesBefore = await db.$count(listLines, eq(listLines.planId, planId));
    expect(linesBefore).toBe(3);

    const next = toPlanRows(
      baseInput({
        householdId,
        budgetUah: 1800, // `cheaper` is exactly a change of budget
        recipeSlugIngredients: new Map([["borshch", ["carrot"]]]),
        picks: [
          {
            day: 1,
            recipeId: "",
            slug: "borshch",
            titleUk: "Борщ",
            portionScale: 1,
            costUah: 120,
            promoShareUah: 20,
            macrosPerServing: { kcal: 500, protein: 30, fat: 15, carbs: 50, fiber: 5 },
          },
        ],
        mapper: mapperResult([skuMatch({ slug: "carrot" })]),
        idBySlug: new Map([["carrot", ingredientIds.get("carrot")!]]),
      }),
    );

    // wrong household → 0, and the plan is untouched
    expect(await replacePlanRows(planId, "00000000-0000-0000-0000-000000000000", next)).toBe(0);
    expect(await db.$count(planItems, eq(planItems.planId, planId))).toBe(2);

    expect(await replacePlanRows(planId, householdId, next)).toBe(1);

    const after = await getPlanDetail(planId, householdId);
    expect(after!.items.map((i) => i.dayIndex)).toEqual([1]);
    expect(after!.list.map((l) => l.slug)).toEqual(["carrot"]);
    expect(after!.budgetUah).toBe(1800);
    // no leftovers from the old body
    expect(await db.$count(listLines, eq(listLines.planId, planId))).toBe(1);
    expect(await db.$count(planItems, eq(planItems.planId, planId))).toBe(1);
    // identity columns survive the body swap
    expect(after!.seed).toBe(7);
    expect(after!.goal).toBe("routine");
  });

  it("markPlanMaterialized flips status + records cartId/materializedAt, scoped to household", async () => {
    await setup();
    const planId = await savePlan(rowsFor());

    const before = await getPlanDetail(planId, householdId);
    expect(before!.status).toBe("draft");
    expect(before!.cartId).toBeNull();
    expect(before!.materializedAt).toBeNull();
    expect(before!.list[0]!.externalProductId).toBe("12345"); // persisted + read back (was dropped)

    // wrong household → 0 rows, nothing changes
    expect(
      await markPlanMaterialized(planId, "00000000-0000-0000-0000-000000000000", "cart-x"),
    ).toBe(0);

    expect(await markPlanMaterialized(planId, householdId, "cart-abc")).toBe(1);
    const after = await getPlanDetail(planId, householdId);
    expect(after!.status).toBe("materialized");
    expect(after!.cartId).toBe("cart-abc");
    expect(after!.materializedAt).not.toBeNull();

    await db.delete(plans).where(eq(plans.id, planId));
  });

  it("same solver result → identical persisted detail (seeded determinism)", async () => {
    await setup();
    const a = await savePlan(rowsFor());
    const b = await savePlan(rowsFor());
    const da = await getPlanDetail(a, householdId);
    const db_ = await getPlanDetail(b, householdId);
    const strip = (d: NonNullable<Awaited<ReturnType<typeof getPlanDetail>>>) => ({
      ...d,
      id: "",
      createdAt: "",
    });
    expect(strip(da!)).toEqual(strip(db_!));
  });
});
