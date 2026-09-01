import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type LlmProvider, LlmUnavailableError } from "./provider.js";
import { defineStep, runStep } from "./step.js";
import { type LlmTracer, noopTracer } from "./tracing.js";

const echoStep = defineStep<{ note: string; phone?: string }, { seen: string }>({
  name: "echo",
  promptVersion: "echo.v1",
  schema: z.object({ seen: z.string() }),
  build: (input) => ({ system: "sys", prompt: JSON.stringify(input) }),
  fallback: (_input, reason) => ({ seen: `fallback:${reason}` }),
});

function providerReturning(value: unknown): LlmProvider {
  return { generateObject: vi.fn(async () => ({ value, model: "fake" })) as never };
}

describe("runStep", () => {
  it("returns the model output tagged source:llm and traces once", async () => {
    const provider = providerReturning({ seen: "ok" });
    const seen = vi.fn();
    const tracer: LlmTracer = {
      trace: (step, version, input, fn) => {
        seen(step, version, input);
        return fn();
      },
    };

    const result = await runStep(echoStep, { note: "hi" }, { provider, tracer });

    expect(result).toEqual({ source: "llm", value: { seen: "ok" } });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("echo", "echo.v1", expect.anything());
  });

  it("strips PII from the input before it reaches the provider (INT-LLM-004)", async () => {
    const provider = providerReturning({ seen: "ok" });
    await runStep(
      echoStep,
      { note: "hi", phone: "+380991112233" },
      { provider, tracer: noopTracer },
    );

    const call = (provider.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt).toContain("«redacted»");
    expect(call.prompt).not.toContain("380991112233");
  });

  it("falls back deterministically when the provider throws", async () => {
    const provider: LlmProvider = {
      generateObject: vi.fn(async () => {
        throw new LlmUnavailableError();
      }) as never,
    };

    const result = await runStep(echoStep, { note: "hi" }, { provider, tracer: noopTracer });

    expect(result.source).toBe("fallback");
    if (result.source === "fallback") {
      expect(result.value.seen).toContain("fallback:");
      expect(result.reason).toMatch(/LlmUnavailableError/);
    }
  });

  it("defaults temperature to 0", async () => {
    const provider = providerReturning({ seen: "ok" });
    await runStep(echoStep, { note: "hi" }, { provider, tracer: noopTracer });
    const call = (provider.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.temperature).toBe(0);
  });
});
