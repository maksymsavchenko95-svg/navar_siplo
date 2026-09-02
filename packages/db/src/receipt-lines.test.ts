import type { RetailOrder } from "@navar/domain";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "./client.js";
import { importCanonicalIngredients } from "./import-ingredients.js";
import {
  type DictEntry,
  linkIngredientSlug,
  normalizeName,
  retailOrdersToRows,
  saveReceiptLines,
  synonymIndex,
} from "./receipt-lines.js";
import { canonicalIngredients, households, receiptLines } from "./schema.js";

const DICT: DictEntry[] = [
  { slug: "milk", nameUk: "Молоко", synonyms: ["молоко", "молоко пастеризоване"] },
  {
    slug: "condensed_milk",
    nameUk: "Молоко згущене",
    synonyms: ["молоко згущене", "згущене молоко", "згущенка"],
  },
  {
    slug: "chicken_breast",
    nameUk: "Куряче філе",
    synonyms: ["куряче філе", "філе куряче", "грудка куряча"],
  },
  {
    slug: "buckwheat_groats",
    nameUk: "Гречка",
    synonyms: ["гречка", "крупа гречана", "гречка ядриця"],
  },
];
const IX = synonymIndex(DICT);

describe("normalizeName", () => {
  it("strips quotes, digits, %, punctuation and collapses whitespace", () => {
    expect(normalizeName("Молоко «Галичина» 2,5% 900мл")).toBe("молоко галичина мл");
  });
  it("folds ё → е", () => {
    expect(normalizeName("Гречка ЁЖ")).toBe("гречка еж");
  });
  it("drops apostrophe variants", () => {
    expect(normalizeName("Філе м'ясо")).toBe("філе мясо");
    expect(normalizeName("мʼякоть свиняча")).toBe("мякоть свиняча");
  });
});

describe("linkIngredientSlug", () => {
  it("matches a synonym phrase in the product name", () => {
    expect(linkIngredientSlug("Молоко «Галичина» 2,5%", IX)).toBe("milk");
    expect(linkIngredientSlug("Філе куряче охолоджене «Наша Ряба»", IX)).toBe("chicken_breast");
    expect(linkIngredientSlug("Гречка ядриця «Розумний вибір» 800г", IX)).toBe("buckwheat_groats");
  });
  it("prefers the longest matching phrase", () => {
    expect(linkIngredientSlug("Молоко згущене «Ічня» 370г", IX)).toBe("condensed_milk");
  });
  it("returns null when nothing matches confidently", () => {
    expect(linkIngredientSlug("Круасан з шоколадом", IX)).toBeNull();
    expect(linkIngredientSlug("", IX)).toBeNull();
  });
});

describe("synonymIndex", () => {
  it("is sorted longest phrase first and drops < 3-char phrases", () => {
    const lengths = IX.map((e) => e.phrase.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(IX.every((e) => e.phrase.length >= 3)).toBe(true);
  });
});

function line(
  key: string,
  name: string,
  quantity: number,
  over: Partial<RetailOrder["lines"][number]> = {},
): RetailOrder["lines"][number] {
  return {
    key,
    name,
    slug: null,
    unitPrice: 40,
    quantity,
    lineTotal: Math.round(40 * quantity * 100) / 100,
    unit: "pcs",
    catalogProductId: null,
    ...over,
  };
}

describe("retailOrdersToRows", () => {
  const orders: RetailOrder[] = [
    {
      source: "offline",
      externalId: "fil:1:2026-08-01",
      createdAt: "2026-08-01T10:00:00.000Z",
      total: 120,
      discount: 0,
      lines: [
        line("milk", "Молоко «Галичина» 2,5%", 2, {
          slug: "moloko-galychyna",
          catalogProductId: "p1",
        }),
        line("name:Круасан", "Круасан з шоколадом", -1),
      ],
    },
    {
      source: "online",
      externalId: "ord-9",
      createdAt: "2026-08-15T09:00:00.000Z",
      total: 80,
      discount: 5,
      lines: [line("buckwheat_groats", "Гречка ядриця 800 г", 1, { unit: "kg" })],
    },
  ];

  it("flattens every line, carrying date, refs and the derived slug", () => {
    const rows = retailOrdersToRows(orders, "hh-1", IX);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      householdId: "hh-1",
      source: "offline",
      orderExternalId: "fil:1:2026-08-01",
      rawName: "Молоко «Галичина» 2,5%",
      aggKey: "milk",
      productRef: "p1",
      catalogSlug: "moloko-galychyna",
      quantity: "2.000",
      unit: "pcs",
      price: "40.00",
      ingredientSlug: "milk",
    });
    expect(rows[0]!.purchasedAt.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    expect(rows[1]!.quantity).toBe("-1.000"); // void / return preserved
    expect(rows[1]!.ingredientSlug).toBeNull();
    expect(rows[2]!.ingredientSlug).toBe("buckwheat_groats");
  });
});

// Integration — only when a database is reachable.
describe.skipIf(!process.env.DATABASE_URL)("saveReceiptLines (integration)", () => {
  let householdId: string;

  afterEach(async () => {
    if (householdId) await db.delete(households).where(eq(households.id, householdId));
  });
  afterAll(closeDb);

  const order = (createdAt: string): RetailOrder => ({
    source: "online",
    externalId: createdAt,
    createdAt,
    total: 100,
    discount: 0,
    lines: [
      line("milk", "Молоко «Галичина» 2,5%", 1),
      line("name:Серветки", "Серветки паперові", 1),
    ],
  });

  it("is idempotent and resolves ingredient_id from the dictionary", async () => {
    await importCanonicalIngredients();
    const [hh] = await db.insert(households).values({ goal: "routine" }).returning();
    householdId = hh!.id;

    const orders = [order("2026-07-01T10:00:00.000Z"), order("2026-08-01T10:00:00.000Z")];

    const first = await saveReceiptLines(db, householdId, orders);
    expect(first).toEqual({ total: 4, linked: 2 });
    expect(await db.$count(receiptLines, eq(receiptLines.householdId, householdId))).toBe(4);

    // Re-run with the same orders — delete + reinsert, no duplication.
    const second = await saveReceiptLines(db, householdId, orders);
    expect(second).toEqual({ total: 4, linked: 2 });
    expect(await db.$count(receiptLines, eq(receiptLines.householdId, householdId))).toBe(4);

    const [milkId] = await db
      .select({ id: canonicalIngredients.id })
      .from(canonicalIngredients)
      .where(eq(canonicalIngredients.slug, "milk"));
    const rows = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.householdId, householdId));
    expect(
      rows
        .filter((r) => r.rawName.startsWith("Молоко"))
        .every((r) => r.ingredientId === milkId!.id),
    ).toBe(true);
    expect(
      rows.filter((r) => r.rawName.startsWith("Серветки")).every((r) => r.ingredientId === null),
    ).toBe(true);
  });

  it("clears a household's lines when it re-bootstraps with no orders", async () => {
    await importCanonicalIngredients();
    const [hh] = await db.insert(households).values({ goal: "routine" }).returning();
    householdId = hh!.id;

    await saveReceiptLines(db, householdId, [order("2026-07-01T10:00:00.000Z")]);
    expect(await db.$count(receiptLines, eq(receiptLines.householdId, householdId))).toBe(2);

    const res = await saveReceiptLines(db, householdId, []);
    expect(res).toEqual({ total: 0, linked: 0 });
    expect(await db.$count(receiptLines, eq(receiptLines.householdId, householdId))).toBe(0);
  });
});
