import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, NoObjectGeneratedError } from "ai";

import {
  type GenerateObjectRequest,
  type GenerateObjectResult,
  type LlmProvider,
  LlmSchemaError,
} from "../provider.js";

/**
 * The only file in the repo that imports an LLM SDK (`ai` / `@ai-sdk/anthropic`) — the
 * mirror of the `@modelcontextprotocol/sdk` grep invariant. Everything else depends on
 * `LlmProvider`.
 */

/**
 * Models that still accept a `temperature` parameter. The Claude 4.6+/5 family removed
 * sampling params — passing `temperature` to `claude-sonnet-5` is a 400. Determinism on
 * those models rests on structured output + the deterministic fallback + seeded RNG
 * elsewhere (ADR-03), not on `temperature: 0`.
 */
const MODELS_WITH_TEMPERATURE = [/^claude-haiku-4-5/, /^claude-3/, /^claude-sonnet-4-5/];

function acceptsTemperature(model: string): boolean {
  return MODELS_WITH_TEMPERATURE.some((re) => re.test(model));
}

/**
 * Transient only. A 401 (bad key), 400 (billing / bad request) or 404 must surface at once —
 * retrying them just burns 7.5 s of backoff per step before the fallback fires.
 */
function isOverloaded(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e.statusCode ?? e.status;
  return (
    code === 429 ||
    code === 503 ||
    code === 529 ||
    /overloaded_error|overloaded|rate.?limit/i.test(e.message ?? "")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff on transient overload — mirrors `@navar/retail`'s `withBackoff`. */
export async function withBackoff<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !isOverloaded(err)) throw err;
      await sleep(500 * 2 ** i);
    }
  }
}

export interface AnthropicLlmProviderOptions {
  apiKey: string;
  /** e.g. `claude-sonnet-5` (env `NAVAR_LLM_MODEL`). */
  model: string;
  /** AI SDK per-call retries, on top of `withBackoff`. Default 2. */
  maxRetries?: number;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly #model: string;
  readonly #maxRetries: number;
  readonly #anthropic: ReturnType<typeof createAnthropic>;

  constructor(opts: AnthropicLlmProviderOptions) {
    this.#model = opts.model;
    this.#maxRetries = opts.maxRetries ?? 2;
    this.#anthropic = createAnthropic({ apiKey: opts.apiKey });
  }

  async generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
    const call = () =>
      generateObject({
        model: this.#anthropic(this.#model),
        schema: req.schema,
        schemaName: req.schemaName,
        system: req.system,
        prompt: req.prompt,
        maxRetries: this.#maxRetries,
        ...(req.signal ? { abortSignal: req.signal } : {}),
        ...(req.temperature !== undefined && acceptsTemperature(this.#model)
          ? { temperature: req.temperature }
          : {}),
      });

    try {
      const { object, usage } = await withBackoff(call);
      return {
        value: object as T,
        usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens },
        model: this.#model,
      };
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        throw new LlmSchemaError(err.message);
      }
      throw err;
    }
  }
}
