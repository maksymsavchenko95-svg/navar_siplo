import type { InferConsumptionInput } from "@navar/domain";
import { inferConsumptionOutputSchema } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { type LlmProvider } from "../provider.js";
import { runStep } from "../step.js";
import { noopTracer } from "../tracing.js";
import { deriveTags, inferConsumptionStep } from "./inferConsumption.js";

const INPUT: InferConsumptionInput = {
  orderCount: 14,
  weeks: 20,
  topItems: [
    { label: "Молоко", buysPer4Weeks: 4.2, category: "dairy_eggs" },
    { label: "Яблука", buysPer4Weeks: 2, category: "fruit" },
    { label: "Морква", buysPer4Weeks: 1.5, category: "vegetable" },
  ],
  topBrands: [
    { brand: "Галичина", category: "dairy_eggs" },
    { brand: "Моршинська", category: "beverage" },
    { brand: "Рудь", category: "dairy_eggs" },
  ],
  medianWeeklyChequeUah: 1850,
};

describe("inferConsumptionStep", () => {
  it("golden: returns tags + summary tagged source:llm", async () => {
    const canned = {
      tags: ["fresh_produce_heavy", "brand_loyal"],
      summary: "Ви часто берете молочне та фрукти.",
    };
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => ({ value: canned, model: "fake" })) as never,
    };
    const result = await runStep(inferConsumptionStep, INPUT, { provider, tracer: noopTracer });
    expect(result).toEqual({ source: "llm", value: canned });
    expect(() => inferConsumptionOutputSchema.parse(result.value)).not.toThrow();
  });

  it("fallback (offline): threshold tags + template summary, no medical language", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new Error("boom");
      }) as never,
    };
    const result = await runStep(inferConsumptionStep, INPUT, { provider, tracer: noopTracer });
    expect(result.source).toBe("fallback");
    if (result.source !== "fallback") return;
    expect(result.value.tags).toContain("brand_loyal");
    expect(result.value.tags).toContain("batch_cooks");
    expect(result.value.summary).toContain("Молоко");
    expect(result.value.summary).not.toMatch(/діагноз|лікуванн|схуднен|дієт|калор/i);
    expect(() => inferConsumptionOutputSchema.parse(result.value)).not.toThrow();
  });

  it("R3b: no 'регулярно берете' when nothing is regular (topItems empty, history not thin)", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new Error("x");
      }) as never,
    };
    const result = await runStep(
      inferConsumptionStep,
      { ...INPUT, orderCount: 12, topItems: [] },
      { provider, tracer: noopTracer },
    );
    if (result.source !== "fallback") throw new Error("expected fallback");
    expect(result.value.summary).not.toMatch(/регулярно берете/);
    expect(result.value.summary).toMatch(/купівель/);
  });

  it("fallback for a thin history says so", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new Error("x");
      }) as never,
    };
    const result = await runStep(
      inferConsumptionStep,
      { ...INPUT, orderCount: 2, topItems: [] },
      { provider, tracer: noopTracer },
    );
    if (result.source !== "fallback") throw new Error("expected fallback");
    expect(result.value.summary).toMatch(/коротка/);
  });
});

describe("deriveTags", () => {
  it("is deterministic and caps at 6", () => {
    expect(deriveTags(INPUT)).toEqual(deriveTags(INPUT));
    expect(deriveTags(INPUT).length).toBeLessThanOrEqual(6);
  });
  it("flags budget_conscious for a low cheque", () => {
    expect(deriveTags({ ...INPUT, medianWeeklyChequeUah: 800 })).toContain("budget_conscious");
  });
});
