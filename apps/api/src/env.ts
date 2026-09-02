import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

// Host runs: repo-root .env first, then apps/api/.env. docker-compose injects env directly.
for (const candidate of [
  fileURLToPath(new URL("../../../.env", import.meta.url)), // repo root
  fileURLToPath(new URL("../.env", import.meta.url)), // apps/api/.env
]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // ignore
    }
  }
}

/** Treat an empty env var (`FOO=` in a copied .env.example, `${FOO:-}` in compose) as absent,
 *  so `.default()` / `.optional()` still apply. Same pattern as `packages/llm/src/env.ts`. */
const orEmpty = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), inner);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: orEmpty(z.coerce.number().int().positive().default(3001)),
  SILPO_MCP_URL: orEmpty(z.string().url().default("https://mcp.silpo.ua/mcp")),
  MCP_OAUTH_CALLBACK_PORT: orEmpty(z.coerce.number().int().positive().default(8765)),
  // BullMQ (household.bootstrap job, T1.4) + sessions (Redis). Host default; compose sets redis://redis:6379.
  REDIS_URL: orEmpty(z.string().url().default("redis://localhost:6379")),

  // ── Auth / sessions ──────────────────────────────────────────────────────
  /** Externally-reachable API base — the Silpo OAuth redirect is `${PUBLIC_API_URL}/auth/silpo/callback`. */
  PUBLIC_API_URL: orEmpty(z.string().url().default("http://localhost:3001")),
  /** The web origin the callback redirects back to + the CORS allowlist. */
  WEB_ORIGIN: orEmpty(z.string().url().default("http://localhost:3000")),
  /** Signs the session + pending-OAuth cookies. `openssl rand -base64 32`. */
  COOKIE_SECRET: orEmpty(z.string().min(16).default("dev-insecure-cookie-secret-change-me")),
  /** Session TTL (seconds); refreshed on use. Default 30 days. */
  SESSION_TTL_S: orEmpty(
    z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 30),
  ),
  /** Pinned Silpo DCR client JSON (prod). Absent → lazily registered + cached in Redis. */
  SILPO_OAUTH_CLIENT: orEmpty(z.string().optional()),
});

export const env = schema.parse(process.env);
