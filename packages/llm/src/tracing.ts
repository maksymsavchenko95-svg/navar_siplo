import { Langfuse } from "langfuse";

/**
 * `LlmTracer` — the port every LLM step call goes through (`FR-OPS-002`). The default is a
 * no-op so the harness runs identically offline and in tests. Langfuse is wired in
 * `apps/api` only when its keys are present (degradation-safe).
 */
export interface LlmTracer {
  trace<T>(step: string, promptVersion: string, input: unknown, fn: () => Promise<T>): Promise<T>;
}

export const noopTracer: LlmTracer = {
  trace: (_step, _promptVersion, _input, fn) => fn(),
};

export interface LangfuseTracerConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
}

/** Records prompt version, input, output and errors for every step to Langfuse. */
export function langfuseTracer(cfg: LangfuseTracerConfig): LlmTracer {
  const lf = new Langfuse({
    publicKey: cfg.publicKey,
    secretKey: cfg.secretKey,
    ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
  });
  return {
    async trace(step, promptVersion, input, fn) {
      const t = lf.trace({ name: step, input, metadata: { promptVersion } });
      try {
        const out = await fn();
        t.update({ output: out });
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        t.update({ output: { error: message }, metadata: { promptVersion, level: "ERROR" } });
        throw err;
      } finally {
        await lf.flushAsync();
      }
    },
  };
}
