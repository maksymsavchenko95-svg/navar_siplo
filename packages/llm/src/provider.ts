import type { z } from "zod";

/**
 * `LlmProvider` — the seam that isolates the product from any single model vendor
 * (`INT-LLM-001`). Nothing outside `@navar/llm` imports an SDK; the harness (`step.ts`)
 * depends only on this interface. **Zero SDK imports in this file.**
 *
 * The LLM only interprets, generates/adapts, re-ranks and explains (ADR-02) — it never
 * touches the cart, budget arithmetic, or allergen checks. Every call returns structured
 * output validated against a Zod schema.
 */
export interface GenerateObjectRequest<T> {
  /** Names the call in traces and in the provider's structured-output request. */
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  /** Already PII-stripped by `runStep` (`INT-LLM-004`). */
  prompt: string;
  /** Determinism hint. Forwarded only to models that still accept it (see the adapter). */
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateObjectResult<T> {
  value: T;
  usage?: { inputTokens?: number; outputTokens?: number };
  model: string;
}

export interface LlmProvider {
  generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>>;
}

/** No usable LLM credentials — every step degrades to its deterministic fallback. */
export class LlmUnavailableError extends Error {
  constructor(readonly reason = "no ANTHROPIC_API_KEY configured") {
    super(reason);
    this.name = "LlmUnavailableError";
  }
}

/** The model replied but its output did not match the step's schema. */
export class LlmSchemaError extends Error {
  constructor(readonly detail: string) {
    super(`LLM output failed schema validation: ${detail}`);
    this.name = "LlmSchemaError";
  }
}
