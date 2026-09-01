/**
 * @navar/db — Drizzle schema, client, migrations, and the Postgres-backed
 * `CredentialStore`. The only package that talks to the database.
 */
export * as schema from "./schema.js";
export { db, closeDb, type Db } from "./client.js";
export { pgCredentialStore } from "./credentials.js";
