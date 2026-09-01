import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { dbEnv } from "./env.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = new Pool({ connectionString: dbEnv.DATABASE_URL });

try {
  // Extensions first: the vector column and the trgm / hnsw indexes need them
  // (ADR-06). Idempotent, safe on every boot.
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

  await migrate(drizzle(pool), { migrationsFolder });
  console.log("[migrate] up to date");
} finally {
  await pool.end();
}
