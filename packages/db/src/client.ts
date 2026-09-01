import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { dbEnv } from "./env.js";
import * as schema from "./schema.js";

const pool = new Pool({ connectionString: dbEnv.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type Db = typeof db;

export async function closeDb(): Promise<void> {
  await pool.end();
}
