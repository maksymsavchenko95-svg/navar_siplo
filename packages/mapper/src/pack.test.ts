import { describe, expect, it } from "vitest";

import { computePack, parsePackSize } from "./pack.js";

describe("parsePackSize", () => {
  it("parses common displayRatio forms into the base unit", () => {
    expect(parsePackSize("800г", "g")).toBe(800);
    expect(parsePackSize("1кг", "g")).toBe(1000);
    expect(parsePackSize("400мл", "ml")).toBe(400);
    expect(parsePackSize("1 л", "ml")).toBe(1000);
    expect(parsePackSize("0,85л", "ml")).toBe(850);
    expect(parsePackSize("10 шт", "pcs")).toBe(10);
    expect(parsePackSize("2х100г", "g")).toBe(200);
  });

  it("returns null for an unrelated unit, a missing value, or a per-unit price label", () => {
    expect(parsePackSize(null, "g")).toBeNull();
    expect(parsePackSize("1кг", "ml")).toBeNull(); // mass pack, volume ingredient
    expect(parsePackSize("за 100 г", "g")).toBeNull();
    expect(parsePackSize("шт", "pcs")).toBeNull();
  });
});

describe("computePack", () => {
  it("buys the smallest sufficient number of whole packs and records surplus", () => {
    expect(computePack(300, 400)).toEqual({
      packCount: 1,
      boughtAmount: 400,
      surplusAmount: 100,
      packSize: 400,
    });
    expect(computePack(900, 400)).toMatchObject({
      packCount: 3,
      boughtAmount: 1200,
      surplusAmount: 300,
    });
  });

  it("has zero surplus on an exact fit", () => {
    expect(computePack(800, 400)).toMatchObject({ packCount: 2, surplusAmount: 0 });
  });

  it("weighed goods buy the exact mass rounded up to the weighing step", () => {
    // need 618 g, step 0.4 kg → 400 g increments → buy 800 g
    expect(computePack(618, null, { weighted: true, step: 0.4 })).toEqual({
      packCount: 1,
      boughtAmount: 800,
      surplusAmount: 182,
      packSize: 400,
    });
  });

  it("unknown pack → buy exactly what's needed, no surplus", () => {
    expect(computePack(250, null)).toEqual({
      packCount: 1,
      boughtAmount: 250,
      surplusAmount: 0,
      packSize: null,
    });
  });

  it("is deterministic", () => {
    expect(computePack(777, 250)).toEqual(computePack(777, 250));
  });
});
