import { parsedRestrictionSchema, parseRestrictionsOutputSchema } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { type LlmProvider, LlmUnavailableError } from "../provider.js";
import { runStep } from "../step.js";
import { noopTracer } from "../tracing.js";
import { matchDictionary, parseRestrictionsStep } from "./parseRestrictions.js";

const INPUT = { phrases: ["алергія на арахіс", "без глютену", "не люблю гриби"] };

describe("parseRestrictionsStep", () => {
  it("pins its prompt version", () => {
    expect(parseRestrictionsStep.promptVersion).toBe("parseRestrictions.v1");
  });

  it("golden: returns the model output tagged source:llm", async () => {
    const canned = {
      restrictions: [
        { kind: "allergen", code: "peanuts", severity: "strict", sourceText: "алергія на арахіс" },
      ],
    };
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => ({ value: canned, model: "fake" })) as never,
    };
    const result = await runStep(parseRestrictionsStep, INPUT, { provider, tracer: noopTracer });
    expect(result).toEqual({ source: "llm", value: canned });
    expect(() => parseRestrictionsOutputSchema.parse(result.value)).not.toThrow();
  });

  it("fallback (offline): dictionary-matches allergens, no network/key", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new LlmUnavailableError();
      }) as never,
    };
    const result = await runStep(parseRestrictionsStep, INPUT, { provider, tracer: noopTracer });
    expect(result.source).toBe("fallback");
    if (result.source !== "fallback") return;
    expect(result.reason).toMatch(/LlmUnavailableError/);
    const codes = result.value.restrictions.map((r) => `${r.kind}:${r.code}`);
    expect(codes).toEqual(["allergen:peanuts", "diet:gluten_free", "dislike:mushroom"]);
    expect(() => parseRestrictionsOutputSchema.parse(result.value)).not.toThrow();
  });
});

describe("matchDictionary", () => {
  it("maps UA/RU/EN allergen phrases to EU-14 codes", () => {
    expect(matchDictionary("no dairy").map((r) => r.code)).toContain("milk");
    expect(matchDictionary("аллергия на морепродукты").map((r) => r.code)).toContain("crustaceans");
    expect(matchDictionary("vegan household").map((r) => r.code)).toContain("vegan");
  });

  it("returns nothing for an unrelated phrase", () => {
    expect(matchDictionary("привіт")).toEqual([]);
  });

  it("is deterministic", () => {
    expect(matchDictionary("без глютену та лактози")).toEqual(
      matchDictionary("без глютену та лактози"),
    );
  });

  it("can yield two restrictions from one phrase", () => {
    const codes = matchDictionary("no eggs or fish").map((r) => r.code);
    expect(codes).toEqual(["fish", "egg"]);
  });

  it("every dictionary hit is a valid discriminated ParsedRestriction (F2 — guards the table)", () => {
    const phrases = [
      "без глютену",
      "лактоза",
      "арахіс, горіхи, кунжут",
      "соя",
      "риба та морепродукти",
      "vegan halal no pork no beef",
      "гриби, кінза",
    ];
    for (const hit of phrases.flatMap(matchDictionary)) {
      expect(() => parsedRestrictionSchema.parse(hit)).not.toThrow();
    }
  });

  it("a non-canonical allergen code fails the output schema, so the LLM path falls back (F2)", () => {
    expect(() =>
      parseRestrictionsOutputSchema.parse({
        restrictions: [
          { kind: "allergen", code: "lactose", severity: "strict", sourceText: "без лактози" },
        ],
      }),
    ).toThrow();
  });
});
