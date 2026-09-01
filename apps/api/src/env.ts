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

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  SILPO_MCP_URL: z.string().url().default("https://mcp.silpo.ua/mcp"),
  MCP_OAUTH_CALLBACK_PORT: z.coerce.number().int().positive().default(8765),
  // BullMQ (household.bootstrap job, T1.4). Host default; compose sets redis://redis:6379.
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
});

export const env = schema.parse(process.env);
