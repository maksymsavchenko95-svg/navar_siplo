import { z } from "zod";

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

// ── health (the audit's F1 lesson: a dead key must be loud, not a silent fallback) ────────

export interface LlmHealth {
  /** `checking` until the startup probe has returned — `/health` never claims more than it knows. */
  status: "checking" | "ok" | "degraded" | "disabled";
  model: string;
  message?: string;
}

let llmHealth: LlmHealth = { status: "checking", model: llmEnv.NAVAR_LLM_MODEL };

/** Last result of `checkLlmHealth` — surfaced by `/health` as `llm`. */
export function getLlmHealth(): LlmHealth {
  return llmHealth;
}

/**
 * One tiny structured call at startup. Never throws: `disabled` (no key) and `degraded`
 * (key rejected, no credits, outage) both log a warning and leave every step on its
 * deterministic fallback — the degradation ladder, made visible. `provider` is injectable
 * so tests never touch the network.
 */
export async function checkLlmHealth(provider: LlmProvider = getLlm()): Promise<LlmHealth> {
  const model = llmEnv.NAVAR_LLM_MODEL;
  if (!llmEnv.ANTHROPIC_API_KEY) {
    llmHealth = { status: "disabled", model };
    console.warn(
      "[llm] DISABLED — no ANTHROPIC_API_KEY; every step will use its deterministic fallback",
    );
    return llmHealth;
  }
  try {
    await provider.generateObject({
      schemaName: "health",
      schema: z.object({ ok: z.boolean() }),
      system: 'Reply with exactly {"ok": true}.',
      prompt: "ping",
      temperature: 0,
    });
    llmHealth = { status: "ok", model };
    console.log(`[llm] ok — model ${model}`);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    llmHealth = { status: "degraded", model, message };
    console.warn(`[llm] DEGRADED — ${message}; every step will use its deterministic fallback`);
  }
  return llmHealth;
}
