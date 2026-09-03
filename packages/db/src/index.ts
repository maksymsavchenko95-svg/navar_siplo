/**
 * @navar/db — Drizzle schema, client, migrations, and the Postgres-backed
 * `CredentialStore`. The only package that talks to the database.
 */
export * as schema from "./schema.js";
export { db, closeDb, type Db } from "./client.js";
export { pgCredentialStore } from "./credentials.js";
export {
  linkIngredientSlug,
  normalizeName,
  retailOrdersToRows,
  saveReceiptLines,
  synonymIndex,
  type SynonymEntry,
} from "./receipt-lines.js";
export { CANONICAL_INGREDIENTS } from "./data/canonical-ingredients.js";
export {
  toPlanRows,
  savePlan,
  setPlanExplanation,
  markPlanMaterialized,
  getPlanDetail,
  listPlans,
  type ToPlanRowsInput,
  type PlanRows,
} from "./plans.js";
