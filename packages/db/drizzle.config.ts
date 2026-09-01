import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` emits SQL into ./drizzle from src/schema.ts.
// Migrations are applied by src/migrate.ts (script `db:migrate`), which ensures the
// `vector` and `pg_trgm` extensions exist first.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://navar:navar@localhost:5432/navar",
  },
  verbose: true,
  strict: true,
});
