import { describe, expect, it } from "vitest";

import { parseCardId } from "./household.js";

describe("parseCardId", () => {
  it("parses a restriction card id (kind + code, code may contain colons)", () => {
    expect(parseCardId("restriction:allergen:milk")).toEqual({
      type: "restriction",
      kind: "allergen",
      code: "milk",
    });
    expect(parseCardId("restriction:dislike:name:пучок кропу")).toEqual({
      type: "restriction",
      kind: "dislike",
      code: "name:пучок кропу",
    });
  });

  it("parses an often/rarely item card id, keeping only slug keys", () => {
    expect(parseCardId("often:milk")).toEqual({ type: "item", slug: "milk" });
    expect(parseCardId("rarely:lager:999")).toEqual({ type: "item", slug: null });
  });

  it("returns null for an unknown id or bad kind", () => {
    expect(parseCardId("weird:thing")).toBeNull();
    expect(parseCardId("restriction:bogus:x")).toBeNull();
  });
});
