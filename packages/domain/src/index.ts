/**
 * @navar/domain — the shared vocabulary of the product (ADR-01). Zod schemas, inferred
 * domain types, unit conversions, and cross-cutting port contracts. Imported by every
 * other package; depends on nothing but zod. No duplicated interfaces anywhere else.
 */
export * from "./schemas.js";
export * from "./units.js";
export * from "./nutrition.js";
export * from "./credentials.js";
