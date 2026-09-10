import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

// Host runs: repo-root .env first, then a CWD .env. docker-compose injects env directly.
for (const candidate of [
  fileURLToPath(new URL("../../../.env", import.meta.url)), // repo root
  `${process.cwd()}/.env`,
]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // ignore malformed / unreadable
    }
  }
}

/** Treat an empty env var (`FOO=` in a copied .env.example) as absent. */
const optionalStr = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const schema = z.object({
  /** Absent → the harness runs every step's deterministic fallback (degradation ladder). */
  ANTHROPIC_API_KEY: optionalStr,
  /** Model id — configurable without a release (`INT-LLM-001`). */
  NAVAR_LLM_MODEL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().default("claude-sonnet-5"),
  ),
  /**
   * Model for the mapper's SKU re-rank step only (T4.5). A smaller/faster model — the task
   * is "pick the best of ≤5 named candidates", not open generation — so `plan.generate`
   * runs its ~12–15 re-ranks quickly. Haiku also honours `temperature: 0` (better
   * determinism). Every other step stays on `NAVAR_LLM_MODEL`.
   */
  NAVAR_LLM_RERANK_MODEL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().default("claude-haiku-4-5"),
  ),
  /** Langfuse tracing (`FR-OPS-002`) — all three must be set for tracing to activate. */
  LANGFUSE_PUBLIC_KEY: optionalStr,
  LANGFUSE_SECRET_KEY: optionalStr,
  LANGFUSE_BASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
});

export const llmEnv = schema.parse(process.env);
