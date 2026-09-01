/**
 * @navar/llm — the LLM harness (roadmap T1.1, TDD §6). Provider-abstracted Claude access
 * with versioned prompt files, Zod structured output, PII stripped before send
 * (`INT-LLM-004`), a deterministic fallback per step (`INT-LLM-003`), and Langfuse tracing
 * (`FR-OPS-002`). The LLM only interprets / generates / re-ranks / explains (ADR-02).
 */
export {
  type GenerateObjectRequest,
  type GenerateObjectResult,
  type LlmProvider,
  LlmSchemaError,
  LlmUnavailableError,
} from "./provider.js";
export { AnthropicLlmProvider, type AnthropicLlmProviderOptions } from "./anthropic/adapter.js";
export { defineStep, type LlmStep, type RunStepDeps, runStep, type StepResult } from "./step.js";
export {
  type LangfuseTracerConfig,
  langfuseTracer,
  type LlmTracer,
  noopTracer,
} from "./tracing.js";
export { loadPrompt, type LoadedPrompt } from "./prompt.js";
export { llmEnv } from "./env.js";
export { explainPlanStep } from "./steps/explainPlan.js";
export { inferConsumptionStep, deriveTags } from "./steps/inferConsumption.js";
export { parseRestrictionsStep, matchDictionary } from "./steps/parseRestrictions.js";
