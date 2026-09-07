import { describe, expect, it } from "vitest";

import {
  ACTIVITY_OPTIONS,
  ALLERGEN_LABEL_UK,
  DIET_LABEL_UK,
  DIRECTION_OPTIONS,
  RESTRICTION_PICKER,
  SEX_OPTIONS,
  labelFor,
} from "./enums";

describe("enum option lists", () => {
  it("sex maps both directions", () => {
    expect(labelFor(SEX_OPTIONS, "female")).toBe("Ж");
    expect(labelFor(SEX_OPTIONS, "male")).toBe("Ч");
  });

  it("activity has all five domain levels", () => {
    expect(ACTIVITY_OPTIONS.map((o) => o.value)).toEqual([
      "sedentary",
      "light",
      "moderate",
      "active",
      "very_active",
    ]);
  });

  it("direction maps to gain/maintain/reduce", () => {
    expect(DIRECTION_OPTIONS.map((o) => o.value)).toEqual(["gain", "maintain", "reduce"]);
  });

  it("labelFor falls back to the raw value when unknown", () => {
    expect(labelFor(SEX_OPTIONS, "unmapped" as (typeof SEX_OPTIONS)[number]["value"])).toBe(
      "unmapped",
    );
  });
});

describe("restriction picker", () => {
  it("covers the 14 EU allergens and the 13 diet codes", () => {
    expect(Object.keys(ALLERGEN_LABEL_UK)).toHaveLength(14);
    expect(Object.keys(DIET_LABEL_UK)).toHaveLength(13);
    expect(RESTRICTION_PICKER).toHaveLength(27);
  });

  it("every pick carries kind + code + label", () => {
    for (const p of RESTRICTION_PICKER) {
      expect(p.kind === "allergen" || p.kind === "diet").toBe(true);
      expect(p.code.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("gluten is an allergen pick with the Ukrainian label", () => {
    const gluten = RESTRICTION_PICKER.find((p) => p.kind === "allergen" && p.code === "gluten");
    expect(gluten?.label).toBe("глютен");
  });
});
