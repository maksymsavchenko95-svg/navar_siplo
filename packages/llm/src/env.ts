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
  /** Langfuse tracing (`FR-OPS-002`) — all three must be set for tracing to activate. */
  LANGFUSE_PUBLIC_KEY: optionalStr,
  LANGFUSE_SECRET_KEY: optionalStr,
  LANGFUSE_BASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
});

export const llmEnv = schema.parse(process.env);
