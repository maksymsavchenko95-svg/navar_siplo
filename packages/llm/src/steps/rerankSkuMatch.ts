import {
  type RerankSkuMatchInput,
  type RerankSkuMatchOutput,
  rerankSkuMatchOutputSchema,
} from "@navar/domain";

import type { LlmProvider } from "../provider.js";
import { loadPrompt } from "../prompt.js";
import { defineStep } from "../step.js";
import { runStep } from "../step.js";
import type { LlmTracer } from "../tracing.js";

const PROMPT = loadPrompt("rerankSkuMatch", 1);

/** Deterministic fallback confidence from the top-1/top-2 score gap (TDD §6). */
function fallbackConfidence(input: RerankSkuMatchInput): number {
  const gap = (input.candidates[0]?.score ?? 0) - (input.candidates[1]?.score ?? 0);
  return Math.max(0, Math.min(0.75, 0.45 + gap));
}

/**
 * `rerankSkuMatch` (TDD §6) — the mapper calls this only when the deterministic top-1/top-2
 * score gap is ≤ 0.25. The LLM re-ranks among ≤5 candidates (ADR-02 — it never scores from
 * scratch); the fallback keeps the deterministic top-1.
 */
export const rerankSkuMatchStep = defineStep<RerankSkuMatchInput, RerankSkuMatchOutput>({
  name: "rerankSkuMatch",
  promptVersion: PROMPT.version,
  schema: rerankSkuMatchOutputSchema,
  build: (input) => ({ system: PROMPT.text, prompt: JSON.stringify(input) }),
  fallback: (input) => ({ index: 0, confidence: fallbackConfidence(input) }),
});

export interface RerankResult {
  index: number;
  confidence: number;
  source: "llm" | "fallback";
}

/**
 * Batteries-included `RerankFn` for `@navar/mapper`: runs the step and flattens
 * `StepResult` to `{ index, confidence, source }`. `runStep` never throws, so neither does
 * this. Also clamps `index` into the candidate range defensively.
 */
export function llmRerank(deps: { provider: LlmProvider; tracer: LlmTracer }) {
  return async (input: RerankSkuMatchInput): Promise<RerankResult> => {
    const result = await runStep(rerankSkuMatchStep, input, deps);
    const max = input.candidates.length - 1;
    const index = Math.max(0, Math.min(max, result.value.index));
    return { index, confidence: result.value.confidence, source: result.source };
  };
}
