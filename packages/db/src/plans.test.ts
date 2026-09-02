import type { MapperResult, SkuMatch } from "@navar/domain";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "./client.js";
import { importCanonicalIngredients } from "./import-ingredients.js";
import {
  getPlanDetail,
  savePlan,
  setPlanExplanation,
  toPlanRows,
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
  },
  score: 0.8,
  confidence: 0.8,
  decision: "accepted",
  needsConfirmation: false,
  packCount: 1,
  packSize: 400,
  surplusAmount: 100,
  isPromo: false,
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
      costUah: 120,
      promoShareUah: 40,
      macrosPerServing: { kcal: 520, protein: 28, fat: 18, carbs: 60 },
    },
    {
      day: 2,
      recipeId: "r-2",
      slug: "plov",
      titleUk: "Плов",
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
            costUah: 120,
            promoShareUah: 40,
            macrosPerServing: { kcal: 520, protein: 28, fat: 18, carbs: 60 },
          },
          {
            day: 2,
            recipeId: "",
            slug: "plov",
            titleUk: "Плов",
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
    await setPlanExplanation(planId, "Тестове пояснення.");

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
