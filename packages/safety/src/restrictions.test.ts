import type { StoredRestriction } from "@navar/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasHardExclusion, resolveExclusions } from "./restrictions.js";

const r = (
  over: Partial<StoredRestriction> & Pick<StoredRestriction, "kind" | "code">,
): StoredRestriction => ({
  severity: "strict",
  source: "onboarding",
  confirmed: true,
  ...over,
});

describe("resolveExclusions", () => {
  it("maps kind:allergen to EU-14 codes", () => {
    const x = resolveExclusions([
      r({ kind: "allergen", code: "milk" }),
      r({ kind: "allergen", code: "gluten" }),
    ]);
    expect(x.allergens).toEqual(["gluten", "milk"]);
  });

  it("bridges the allergen-equivalent diet codes", () => {
    expect(resolveExclusions([r({ kind: "diet", code: "gluten_free" })]).allergens).toEqual([
      "gluten",
    ]);
    expect(resolveExclusions([r({ kind: "diet", code: "lactose_free" })]).allergens).toEqual([
      "milk",
    ]);
    expect(resolveExclusions([r({ kind: "diet", code: "dairy_free" })]).allergens).toEqual([
      "milk",
    ]);
  });

  it("leaves category diets to T2.3 (no allergen / ingredient exclusion)", () => {
    const x = resolveExclusions([
      r({ kind: "diet", code: "vegan" }),
      r({ kind: "diet", code: "no_pork" }),
    ]);
    expect(x).toEqual({ allergens: [], ingredients: [], strictMode: false });
  });

  it("takes strict dislikes as ingredient exclusions, skips soft and name: entries", () => {
    const x = resolveExclusions([
      r({ kind: "dislike", code: "mushroom", severity: "strict" }),
      r({ kind: "dislike", code: "cilantro", severity: "soft" }),
      r({ kind: "dislike", code: "name:пучок кропу", severity: "strict" }),
    ]);
    expect(x.ingredients).toEqual(["mushroom"]);
  });

  it("passes strictMode through and is deterministic", () => {
    const input = [r({ kind: "allergen", code: "egg" }), r({ kind: "diet", code: "gluten_free" })];
    const a = resolveExclusions(input, { strictMode: true });
    const b = resolveExclusions([...input].reverse(), { strictMode: true });
    expect(a).toEqual(b);
    expect(a.strictMode).toBe(true);
  });

  it("hasHardExclusion reflects allergens or ingredients", () => {
    expect(hasHardExclusion(resolveExclusions([]))).toBe(false);
    expect(hasHardExclusion(resolveExclusions([r({ kind: "allergen", code: "milk" })]))).toBe(true);
  });

  describe("non-canonical allergen codes are not dropped silently (F2)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("remaps a known synonym and warns", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const x = resolveExclusions([r({ kind: "allergen", code: "lactose" })]);
      expect(x.allergens).toEqual(["milk"]); // never []
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("lactose"));
    });

    it("warns loudly when a code cannot be remapped", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const x = resolveExclusions([r({ kind: "allergen", code: "???" })]);
      expect(x.allergens).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("needs review"));
    });
  });
});
