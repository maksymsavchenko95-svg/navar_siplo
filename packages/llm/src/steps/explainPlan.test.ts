import type { ExplainPlanInput } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { type LlmProvider, LlmUnavailableError } from "../provider.js";
import { runStep } from "../step.js";
import { noopTracer } from "../tracing.js";
import { explainPlanStep } from "./explainPlan.js";

const ROUTINE_INPUT: ExplainPlanInput = {
  days: 5,
  budgetUah: 2500,
  totalUah: 2380,
  savingsUah: 320,
  promoSharePct: 34,
  goal: "routine",
  dishes: ["Плов з куркою", "Омлет з морквою"],
};

const FORM_INPUT: ExplainPlanInput = { ...ROUTINE_INPUT, goal: "form" };

describe("explainPlanStep", () => {
  it("pins its prompt version", () => {
    expect(explainPlanStep.promptVersion).toBe("explainPlan.v1");
  });

  it("golden: returns the model text tagged source:llm", async () => {
    const canned =
      "План на 5 днів укладено в бюджет 2 500 ₴: разом 2 380 ₴, економія 320 ₴. " +
      "Акційні позиції покривають 34% вартості. Серед страв — Плов з куркою та Омлет з морквою.";
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => ({ value: { text: canned }, model: "fake" })) as never,
    };

    const result = await runStep(explainPlanStep, ROUTINE_INPUT, { provider, tracer: noopTracer });

    expect(result).toEqual({ source: "llm", value: { text: canned } });
  });

  it("fallback (offline): renders the deterministic template, no network, no key", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new LlmUnavailableError();
      }) as never,
    };

    const result = await runStep(explainPlanStep, ROUTINE_INPUT, { provider, tracer: noopTracer });

    expect(result.source).toBe("fallback");
    if (result.source !== "fallback") return;
    expect(result.reason).toMatch(/LlmUnavailableError/);
    expect(result.value.text).toBe(
      "План на 5 днів укладено в бюджет 2 500 ₴: разом 2 380 ₴, економія 320 ₴." +
        " Акційні позиції покривають 34% вартості." +
        " Серед страв — Плов з куркою, Омлет з морквою.",
    );
  });

  it("fallback for form mode adds the goal clause without medical language", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new Error("boom");
      }) as never,
    };
    const result = await runStep(explainPlanStep, FORM_INPUT, { provider, tracer: noopTracer });
    if (result.source !== "fallback") throw new Error("expected fallback");
    expect(result.value.text).toContain("цілей за білком і калоріями");
    expect(result.value.text).not.toMatch(/діагноз|лікуванн|схуднен|дієт/i);
  });

  it("fallback output stays within the schema bound", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new Error("boom");
      }) as never,
    };
    const result = await runStep(explainPlanStep, ROUTINE_INPUT, { provider, tracer: noopTracer });
    if (result.source !== "fallback") throw new Error("expected fallback");
    expect(() => explainPlanStep.schema.parse(result.value)).not.toThrow();
  });
});
