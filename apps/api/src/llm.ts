import {
  AnthropicLlmProvider,
  langfuseTracer,
  type LlmProvider,
  type LlmTracer,
  llmEnv,
  LlmUnavailableError,
  noopTracer,
} from "@navar/llm";

/**
 * Process-wide LLM wiring (mirror of `retail.ts`). When `ANTHROPIC_API_KEY` is absent the
 * provider throws `LlmUnavailableError` on every call and each step degrades to its
 * deterministic fallback — the "no LLM → plan without explanations" rung of the
 * degradation ladder. Langfuse tracing activates only when all three keys are present.
 */

let provider: LlmProvider | undefined;
let tracer: LlmTracer | undefined;

export function getLlm(): LlmProvider {
  if (!provider) {
    provider = llmEnv.ANTHROPIC_API_KEY
      ? new AnthropicLlmProvider({
          apiKey: llmEnv.ANTHROPIC_API_KEY,
          model: llmEnv.NAVAR_LLM_MODEL,
        })
      : {
          generateObject() {
            return Promise.reject(new LlmUnavailableError());
          },
        };
  }
  return provider;
}

export function getLlmTracer(): LlmTracer {
  if (!tracer) {
    tracer =
      llmEnv.LANGFUSE_PUBLIC_KEY && llmEnv.LANGFUSE_SECRET_KEY
        ? langfuseTracer({
            publicKey: llmEnv.LANGFUSE_PUBLIC_KEY,
            secretKey: llmEnv.LANGFUSE_SECRET_KEY,
            ...(llmEnv.LANGFUSE_BASE_URL ? { baseUrl: llmEnv.LANGFUSE_BASE_URL } : {}),
          })
        : noopTracer;
  }
  return tracer;
}
