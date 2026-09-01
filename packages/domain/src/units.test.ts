import { describe, expect, it } from "vitest";

import { convert, UnitConversionError } from "./units.js";

describe("convert", () => {
  it("scales within the same dimension", () => {
    expect(convert(2, "kg", "g")).toBe(2000);
    expect(convert(500, "ml", "l")).toBe(0.5);
  });

  it("converts mass ↔ volume using density", () => {
    // sunflower oil ≈ 0.92 g/ml → 92 g in 100 ml
    expect(convert(100, "ml", "g", 0.92)).toBeCloseTo(92);
    expect(convert(92, "g", "ml", 0.92)).toBeCloseTo(100);
  });

  it("fails closed without a density", () => {
    expect(() => convert(100, "ml", "g")).toThrow(UnitConversionError);
  });

  it("refuses to convert count units", () => {
    expect(() => convert(3, "pcs", "g", 50)).toThrow(UnitConversionError);
  });
});
