import type { RerankSkuMatchInput } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { type LlmProvider, LlmUnavailableError } from "../provider.js";
import { runStep } from "../step.js";
import { noopTracer } from "../tracing.js";
import { llmRerank, rerankSkuMatchStep } from "./rerankSkuMatch.js";

const INPUT: RerankSkuMatchInput = {
  ingredient: { name: "Молоко", category: "dairy_eggs", neededQty: 500, unit: "ml" },
  candidates: [
    { name: "Молоко Яготинське 2.5%", packSize: "900мл", price: 42, promo: false, score: 0.7 },
    { name: "Молоко згущене з цукром", packSize: "370г", price: 55, promo: true, score: 0.62 },
  ],
};

describe("rerankSkuMatchStep", () => {
  it("pins its prompt version", () => {
    expect(rerankSkuMatchStep.promptVersion).toBe("rerankSkuMatch.v1");
  });

  it("golden: returns the model pick tagged source:llm", async () => {
    const canned = { index: 0, confidence: 0.88 };
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => ({ value: canned, model: "fake" })) as never,
    };
    const result = await runStep(rerankSkuMatchStep, INPUT, { provider, tracer: noopTracer });
    expect(result).toEqual({ source: "llm", value: canned });
  });

  it("fallback (offline): keeps the deterministic top-1 with a gap-derived confidence", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new LlmUnavailableError();
      }) as never,
    };
    const result = await runStep(rerankSkuMatchStep, INPUT, { provider, tracer: noopTracer });
    expect(result.source).toBe("fallback");
    if (result.source !== "fallback") return;
    expect(result.reason).toMatch(/LlmUnavailableError/);
    // gap = 0.7 - 0.62 = 0.08 → confidence = clamp(0.45 + 0.08) = 0.53
    expect(result.value).toEqual({ index: 0, confidence: expect.closeTo(0.53, 5) });
  });

  it("fallback output stays within the schema bound", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new Error("boom");
      }) as never,
    };
    const result = await runStep(rerankSkuMatchStep, INPUT, { provider, tracer: noopTracer });
    if (result.source !== "fallback") throw new Error("expected fallback");
    expect(() => rerankSkuMatchStep.schema.parse(result.value)).not.toThrow();
  });
});

describe("llmRerank", () => {
  it("flattens the llm path and clamps the index into range", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => ({
        value: { index: 9, confidence: 0.9 },
        model: "fake",
      })) as never,
    };
    const out = await llmRerank({ provider, tracer: noopTracer })(INPUT);
    expect(out).toEqual({ index: 1, confidence: 0.9, source: "llm" }); // 9 clamped to last index
  });

  it("returns source:fallback when the provider throws", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new LlmUnavailableError();
      }) as never,
    };
    const out = await llmRerank({ provider, tracer: noopTracer })(INPUT);
    expect(out.source).toBe("fallback");
    expect(out.index).toBe(0);
  });
});
