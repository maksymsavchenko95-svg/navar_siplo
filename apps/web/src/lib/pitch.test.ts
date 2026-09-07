import { describe, expect, it } from "vitest";

import { PITCH_SECTIONS, screenIdForPath } from "./pitch";

describe("PITCH_SECTIONS", () => {
  it("has five sections numbered 1..5 in order", () => {
    expect(PITCH_SECTIONS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
  });
  it("every section has a headline, paragraphs and annotations", () => {
    for (const s of PITCH_SECTIONS) {
      expect(s.headline.length).toBeGreaterThan(0);
      expect(s.paragraphs.length).toBeGreaterThan(0);
      expect(s.annotations.length).toBeGreaterThan(0);
    }
  });
});

describe("screenIdForPath", () => {
  it.each([
    ["/", 1],
    ["/goal", 1],
    ["/dev", 1],
    ["/numbers", 2],
    ["/tastes", 3],
    ["/tastes/trace", 3],
    ["/plan", 4],
    ["/plan/abc-123", 4],
    ["/plan/abc-123/trace", 4],
    ["/plans", 4],
    ["/plan/abc-123/cart", 5],
  ] as const)("%s → section %i", (path, id) => {
    expect(screenIdForPath(path)).toBe(id);
  });
});
