import type { ExplainChangeInput } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { type LlmProvider, LlmUnavailableError } from "../provider.js";
import { runStep } from "../step.js";
import { noopTracer } from "../tracing.js";
import { explainChangeStep } from "./explainChange.js";

const SWAP: ExplainChangeInput = {
  kind: "replace_item",
  goal: "routine",
  budgetBeforeUah: 2500,
  budgetAfterUah: 2500,
  totalBeforeUah: 2380,
  totalAfterUah: 2200,
  removedDishes: ["Гречка з грибами"],
  addedDishes: ["Курка з броколі"],
  changedDays: [3],
  promoSharePctBefore: 34,
  promoSharePctAfter: 36,
};

const CHEAPER: ExplainChangeInput = {
  ...SWAP,
  kind: "cheaper",
  budgetAfterUah: 2200,
  totalAfterUah: 2150,
  removedDishes: ["Форель"],
  addedDishes: ["Хек"],
  changedDays: [1],
  promoSharePctAfter: 52,
};

const offline: LlmProvider = {
  generateObject: vi.fn(async () => {
    throw new LlmUnavailableError();
  }) as never,
};

describe("explainChangeStep", () => {
  it("pins its prompt version", () => {
    expect(explainChangeStep.promptVersion).toBe("explainChange.v1");
  });

  it("golden: returns the model text tagged source:llm", async () => {
    const canned = "Замінили «Гречку з грибами» на «Курку з броколі» — на 180 ₴ дешевше.";
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => ({ value: { text: canned }, model: "fake" })) as never,
    };
    expect(await runStep(explainChangeStep, SWAP, { provider, tracer: noopTracer })).toEqual({
      source: "llm",
      value: { text: canned },
    });
  });

  it("fallback (offline): names both dishes and the direction of the change", async () => {
    const result = await runStep(explainChangeStep, SWAP, {
      provider: offline,
      tracer: noopTracer,
    });
    expect(result.source).toBe("fallback");
    expect(result.value.text).toBe(
      "Замінили «Гречка з грибами» на «Курка з броколі». Разом — 2 200 ₴, це на 180 ₴ дешевше.",
    );
  });

  it("fallback for `cheaper` states the new budget and the promo move", async () => {
    const result = await runStep(explainChangeStep, CHEAPER, {
      provider: offline,
      tracer: noopTracer,
    });
    expect(result.value.text).toContain("Перебудували план під бюджет 2 200 ₴");
    expect(result.value.text).toContain("дешевше");
    expect(result.value.text).toContain("52%"); // moved 34 → 52, worth mentioning
  });

  it("says 'дорожче' when a swap costs more, never mislabelling the direction", async () => {
    const dearer = { ...SWAP, totalAfterUah: 2500 };
    const result = await runStep(explainChangeStep, dearer, {
      provider: offline,
      tracer: noopTracer,
    });
    expect(result.value.text).toContain("на 120 ₴ дорожче");
    expect(result.value.text).not.toContain("дешевше");
  });

  it("handles an unchanged total without claiming a saving", async () => {
    const same = { ...SWAP, totalAfterUah: SWAP.totalBeforeUah };
    const result = await runStep(explainChangeStep, same, {
      provider: offline,
      tracer: noopTracer,
    });
    expect(result.value.text).toContain("як і було");
    expect(result.value.text).not.toMatch(/дешевше|дорожче/);
  });

  it("stays silent about promo when it barely moved", async () => {
    const flat = { ...SWAP, promoSharePctAfter: 35 };
    const result = await runStep(explainChangeStep, flat, {
      provider: offline,
      tracer: noopTracer,
    });
    expect(result.value.text).not.toContain("акційних");
  });

  it("degrades gracefully when dish names are missing", async () => {
    const bare = { ...SWAP, removedDishes: [], addedDishes: [] };
    const result = await runStep(explainChangeStep, bare, {
      provider: offline,
      tracer: noopTracer,
    });
    expect(result.value.text).toContain("Оновили одну страву");
  });

  it("uses no medical or weight-loss language (CON-04, FR-SAFE-008)", async () => {
    for (const input of [SWAP, CHEAPER, { ...SWAP, goal: "form" as const }]) {
      const result = await runStep(explainChangeStep, input, {
        provider: offline,
        tracer: noopTracer,
      });
      expect(result.value.text).not.toMatch(/діагноз|лікуванн|схуднен|дієт/i);
      expect(result.value.text.length).toBeLessThanOrEqual(600); // schema bound
    }
  });
});
