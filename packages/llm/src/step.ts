import { redact } from "@navar/domain";
import type { z } from "zod";

import type { LlmProvider } from "./provider.js";
import type { LlmTracer } from "./tracing.js";

/**
 * The result of running an LLM step. `source` says which path produced `value` — the model
 * or the deterministic fallback — so traces and golden tests can assert on it
 * (`INT-LLM-003`, ADR-03). Modelled as a discriminated union returned, not thrown, to match
 * the codebase idiom.
 */
export type StepResult<Out> =
  { source: "llm"; value: Out } | { source: "fallback"; value: Out; reason: string };

/**
 * A narrow LLM step (TDD §6). Each carries its schema, its prompt builder, and — always —
 * a deterministic fallback that runs offline when the model is unavailable or its output
 * fails validation.
 */
export interface LlmStep<In, Out> {
  name: string;
  /** From `loadPrompt(...)` — pinned in traces and golden snapshots. */
  promptVersion: string;
  schema: z.ZodType<Out>;
  build(input: In): { system: string; prompt: string };
  fallback(input: In, reason: string): Out;
  /** Determinism hint; default 0. Forwarded only to models that accept it (see the adapter). */
  temperature?: number;
}

export function defineStep<In, Out>(cfg: LlmStep<In, Out>): LlmStep<In, Out> {
  return { temperature: 0, ...cfg };
}

export interface RunStepDeps {
  provider: LlmProvider;
  tracer: LlmTracer;
}

/**
 * Run a step: strip PII from the input (`INT-LLM-004`), trace the call, ask the provider
 * for structured output, and on *any* failure fall back to the deterministic path. Never
 * throws for an LLM/transport failure — a step always returns a usable value.
 */
export async function runStep<In, Out>(
  step: LlmStep<In, Out>,
  input: In,
  deps: RunStepDeps,
): Promise<StepResult<Out>> {
  const safeInput = redact(input) as In;

  return deps.tracer.trace(step.name, step.promptVersion, safeInput, async () => {
    try {
      const { system, prompt } = step.build(safeInput);
      const { value } = await deps.provider.generateObject({
        schemaName: step.name,
        schema: step.schema,
        system,
        prompt,
        temperature: step.temperature ?? 0,
      });
      return { source: "llm", value } satisfies StepResult<Out>;
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      // Visible by default (FR-OPS-002 baseline): an invalid key, an empty balance, or an
      // outage must never look like a working model. Input is not logged (PII).
      console.warn(`[llm] ${step.name} v${step.promptVersion} → fallback: ${reason.slice(0, 200)}`);
      return {
        source: "fallback",
        value: step.fallback(safeInput, reason),
        reason,
      } satisfies StepResult<Out>;
    }
  });
}
