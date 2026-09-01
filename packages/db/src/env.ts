import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

// Load env for host runs: the repo-root .env first, then a CWD .env if present.
// In docker-compose the environment is injected and neither file exists.
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

const schema = z.object({
  DATABASE_URL: z.string().url(),
  // 32-byte key, base64, for AES-256-GCM encryption of MCP tokens at rest.
  // P0: a single static key from the environment. P1: wrap per-row data keys with KMS.
  MCP_TOKEN_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "MCP_TOKEN_KEY must be 32 bytes, base64")
    .optional(),
});

export const dbEnv = schema.parse(process.env);
