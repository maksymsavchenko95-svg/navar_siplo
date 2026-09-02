import { describe, expect, it } from "vitest";

import { ConsolidationError, consolidate, toBaseAmount } from "./consolidate.js";
import type { MapperDictEntry, PlanIngredientLine } from "./types.js";

const entry = (
  over: Partial<MapperDictEntry> & Pick<MapperDictEntry, "slug">,
): MapperDictEntry => ({
  nameUk: over.slug,
  category: "other",
  baseUnit: "g",
  densityGMl: null,
  gramsPerPiece: null,
  synonyms: [],
  ...over,
});

const CARROT = entry({ slug: "carrot", nameUk: "Морква", category: "vegetable" });
const OIL = entry({
  slug: "oil",
  nameUk: "Олія",
  category: "fat_oil",
  baseUnit: "ml",
  densityGMl: 0.92,
});
const MILK = entry({
  slug: "milk",
  nameUk: "Молоко",
  category: "dairy_eggs",
  baseUnit: "ml",
  densityGMl: 1.03,
});
const EGG = entry({
  slug: "egg",
  nameUk: "Яйця",
  category: "dairy_eggs",
  baseUnit: "pcs",
  gramsPerPiece: 55,
});
const dict = new Map([CARROT, OIL, MILK, EGG].map((e) => [e.slug, e]));

describe("toBaseAmount", () => {
  it("passes through when the unit is already the base unit", () => {
    expect(toBaseAmount(CARROT, 200, "g")).toBe(200);
  });

  it("folds kg / l into the base unit", () => {
    expect(toBaseAmount(CARROT, 1.2, "kg")).toBe(1200);
    expect(toBaseAmount(OIL, 1, "l")).toBe(1000);
  });

  it("converts mass↔volume via density", () => {
    expect(toBaseAmount(MILK, 103, "g")).toBeCloseTo(100, 6); // 103 g / 1.03 = 100 ml
  });

  it("bridges pcs↔grams via gramsPerPiece", () => {
    expect(toBaseAmount(EGG, 3, "pcs")).toBe(3);
    expect(toBaseAmount(entry({ slug: "x", baseUnit: "g", gramsPerPiece: 50 }), 2, "pcs")).toBe(
      100,
    );
  });

  it("fails closed: pcs ingredient, mass line, no gramsPerPiece", () => {
    expect(() => toBaseAmount(entry({ slug: "egg2", baseUnit: "pcs" }), 100, "g")).toThrow(
      ConsolidationError,
    );
  });

  it("fails closed: mass↔volume with no density", () => {
    expect(() => toBaseAmount(entry({ slug: "syrup", baseUnit: "ml" }), 100, "g")).toThrow(
      ConsolidationError,
    );
  });
});

describe("consolidate", () => {
  const lines = (xs: PlanIngredientLine[]) => xs;

  it("sums identical ingredients across lines", () => {
    const out = consolidate(
      lines([
        { slug: "carrot", amount: 200, unit: "g" },
        { slug: "carrot", amount: 150, unit: "g" },
        { slug: "oil", amount: 30, unit: "ml" },
      ]),
      dict,
    );
    expect(out).toEqual([
      {
        slug: "carrot",
        nameUk: "Морква",
        category: "vegetable",
        baseUnit: "g",
        amount: 350,
        lineCount: 2,
        optionalOnly: false,
      },
      {
        slug: "oil",
        nameUk: "Олія",
        category: "fat_oil",
        baseUnit: "ml",
        amount: 30,
        lineCount: 1,
        optionalOnly: false,
      },
    ]);
  });

  it("mixes ml and l for one ingredient", () => {
    const out = consolidate(
      lines([
        { slug: "oil", amount: 150, unit: "ml" },
        { slug: "oil", amount: 1, unit: "l" },
      ]),
      dict,
    );
    expect(out[0]!.amount).toBe(1150);
  });

  it("is order-independent (determinism)", () => {
    const a = consolidate(
      lines([
        { slug: "oil", amount: 10, unit: "ml" },
        { slug: "carrot", amount: 100, unit: "g" },
        { slug: "carrot", amount: 50, unit: "g" },
      ]),
      dict,
    );
    const b = consolidate(
      lines([
        { slug: "carrot", amount: 50, unit: "g" },
        { slug: "oil", amount: 10, unit: "ml" },
        { slug: "carrot", amount: 100, unit: "g" },
      ]),
      dict,
    );
    expect(a).toEqual(b);
  });

  it("optionalOnly is true only when every contributing line is optional", () => {
    expect(
      consolidate(lines([{ slug: "carrot", amount: 5, unit: "g", optional: true }]), dict)[0]!
        .optionalOnly,
    ).toBe(true);
    expect(
      consolidate(
        lines([
          { slug: "carrot", amount: 5, unit: "g", optional: true },
          { slug: "carrot", amount: 5, unit: "g" },
        ]),
        dict,
      )[0]!.optionalOnly,
    ).toBe(false);
  });

  it("fails closed on an unknown slug", () => {
    expect(() => consolidate(lines([{ slug: "unicorn", amount: 1, unit: "g" }]), dict)).toThrow(
      /unknown ingredient slug: unicorn/,
    );
  });
});
