/**
 * `household.bootstrap` orchestrator (`FR-HH-001..003`, `AC-P0-02`, roadmap T1.4).
 *
 * Pure of BullMQ — takes its dependencies as an argument so it runs the same in the worker
 * and in tests (pattern: `apps/api/src/scripts/audit-util.ts`). Reads the Silpo MCP,
 * derives the `ConsumptionModel` deterministically (ADR-02), runs the two LLM steps
 * (`inferConsumption`, `parseRestrictions` — each with an offline fallback), and writes
 * `households` + members + restrictions + `consumption_models` + `household_preferences`.
 * Every write is idempotent (upsert or delete-by-household-then-insert); `confirmed_at` on
 * a restriction survives a re-bootstrap (`FR-HH-004`).
 */

import type { Db } from "@navar/db";
import { saveReceiptLines, schema } from "@navar/db";
import type {
  CartContext,
  ConsumptionModel,
  HouseholdPreferences,
  McpToolsResult,
  ParsedRestriction,
} from "@navar/domain";
import {
  inferConsumptionStep,
  type LlmProvider,
  type LlmTracer,
  parseRestrictionsStep,
  runStep,
} from "@navar/llm";
import type { HouseholdReader } from "@navar/retail";
import { NoCartError } from "@navar/retail";
import { and, eq, inArray, sql } from "drizzle-orm";

import { buildConsumptionModel, toInferConsumptionInput } from "./consumption.js";

const MIN_ORDERS = 3;
const ONLINE_PAGE_CAP = 200;
/** Live MCP caps `silpo_get_my_online_orders` `limit` at 50 (snapshot says 100). */
const ONLINE_PAGE_SIZE = 50;

/** Tools `runBootstrap` needs — validated live at start (`INT-MCP-001`), never hardcoded elsewhere. */
export const REQUIRED_TOOLS = [
  "silpo_get_my_profile",
  "silpo_get_my_family",
  "silpo_get_my_food_restrictions",
  "silpo_get_my_delivery_addresses",
  "silpo_get_my_online_orders",
  "silpo_get_my_offline_orders",
  "silpo_get_my_favorites",
] as const;

export interface BootstrapReader extends HouseholdReader {
  listTools(): Promise<McpToolsResult>;
  getCartContext(): Promise<CartContext>;
}

export interface BootstrapDeps {
  reader: BootstrapReader;
  llm: LlmProvider;
  tracer: LlmTracer;
  db: Db;
  now: () => Date;
}

export type BootstrapResult =
  | { outcome: "done"; orderCount: number }
  | { outcome: "onboarding_required"; orderCount: number }
  | { outcome: "auth_required" }
  | { outcome: "error"; message: string };

async function setStatus(
  db: Db,
  householdId: string,
  status: string,
  extra: Partial<{ bootstrapError: string | null; bootstrappedAt: Date }> = {},
): Promise<void> {
  await db
    .update(schema.households)
    .set({ bootstrapStatus: status, bootstrapError: null, ...extra })
    .where(eq(schema.households.id, householdId));
}

export async function runBootstrap(
  householdId: string,
  deps: BootstrapDeps,
): Promise<BootstrapResult> {
  const { reader, llm, tracer, db, now } = deps;
  try {
    await setStatus(db, householdId, "running");

    // 1–2. Live tool catalogue + contract check (INT-MCP-001).
    const tools = await reader.listTools();
    if (tools.status !== "ok") {
      await setStatus(db, householdId, "error", { bootstrapError: "auth_required" });
      return { outcome: "auth_required" };
    }
    const names = new Set(tools.tools.map((t) => t.name));
    const missing = REQUIRED_TOOLS.filter((t) => !names.has(t));
    if (missing.length > 0) {
      const message = `Silpo MCP is missing required tools: ${missing.join(", ")}`;
      await setStatus(db, householdId, "error", { bootstrapError: message });
      return { outcome: "error", message };
    }

    // 3. Ungated reads — a single failure degrades that facet only.
    const [profileR, familyR, restrictionsR, addressesR] = await Promise.allSettled([
      reader.getProfile(),
      reader.getFamily(),
      reader.getFoodRestrictions(),
      reader.getDeliveryAddresses(),
    ]);
    const profile = profileR.status === "fulfilled" ? profileR.value : null;
    const family = familyR.status === "fulfilled" ? familyR.value : null;
    const rawRestrictions = restrictionsR.status === "fulfilled" ? restrictionsR.value : [];
    const addresses = addressesR.status === "fulfilled" ? addressesR.value : [];

    // 4. Online orders (primary signal), paginated to a cap.
    const online = await paginate(
      (offset) => reader.getOnlineOrders({ limit: ONLINE_PAGE_SIZE, offset }),
      ONLINE_PAGE_SIZE,
      ONLINE_PAGE_CAP,
    );

    // 5. Cart-gated reads — optional.
    let branchId: string | null = null;
    let deliveryType: string | null = null;
    let offline: Awaited<ReturnType<BootstrapReader["getOfflineOrders"]>> = [];
    try {
      const ctx = await reader.getCartContext();
      branchId = ctx.branchId;
      deliveryType = ctx.deliveryType;
      offline = await reader.getOfflineOrders({ limit: 10, offset: 0 });
    } catch (err) {
      if (!(err instanceof NoCartError)) throw err;
    }

    const orders = [...online, ...offline];
    const nowDate = now();

    // 5b. Retain the raw purchased lines (T1.6, `FR-HH-002`) — the replayable source the
    // consumption model + P1 pantry sit on. Runs for the sparse-history case too.
    // Idempotent: per-household delete + insert, re-deriving `ingredient_id` each run.
    await saveReceiptLines(db, householdId, orders);

    // 6. Family → members (rebuild).
    await db
      .delete(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, householdId));
    if (family) {
      const rows = [
        ...Array.from({ length: Math.max(family.adultCount, 1) }, () => ({
          householdId,
          kind: "adult",
          ageYears: null as number | null,
          label: null as string | null,
        })),
        ...family.childAgeYears.map((age) => ({
          householdId,
          kind: "child",
          ageYears: age,
          label: null,
        })),
        ...Array.from({ length: family.petCount }, () => ({
          householdId,
          kind: "pet",
          ageYears: null,
          label: null,
        })),
      ];
      if (rows.length > 0) await db.insert(schema.householdMembers).values(rows);
    }

    // 7. Identity fields. `silpoUserRef` is only set when unset — it's the seed's
    // idempotency key (`'demo'`), and clobbering it makes `pnpm db:seed` create a duplicate.
    if (branchId || deliveryType) {
      await db
        .update(schema.households)
        .set({
          ...(branchId ? { branchId } : {}),
          ...(deliveryType ? { deliveryType } : {}),
        })
        .where(eq(schema.households.id, householdId));
    }
    if (profile?.silpoProfileId) {
      await db
        .update(schema.households)
        .set({ silpoUserRef: profile.silpoProfileId })
        .where(
          and(
            eq(schema.households.id, householdId),
            sql`${schema.households.silpoUserRef} IS NULL`,
          ),
        );
    }

    // 8. Restrictions — LLM parse + dictionary fallback, then idempotent upsert.
    const parsed = await runStep(
      parseRestrictionsStep,
      { phrases: rawRestrictions.map((r) => r.text).slice(0, 50) },
      { provider: llm, tracer },
    );
    await upsertRestrictions(db, householdId, parsed.value.restrictions, "mcp");

    // 9. Onboarding fallback (FR-HH-003).
    if (orders.length < MIN_ORDERS) {
      await upsertConsumptionModel(db, householdId, {
        source: "onboarding",
        orderCount: orders.length,
        window: null,
        medianWeeklyChequeUah: null,
        buyFrequency: [],
        brandAffinity: [],
      });
      await upsertPreferences(db, householdId, "inferred", await dislikedSlugs(db, householdId));
      await setStatus(db, householdId, "onboarding_required");
      return { outcome: "onboarding_required", orderCount: orders.length };
    }

    // 10. Consumption model (deterministic) + inferConsumption (interpretation).
    const model = buildConsumptionModel(orders, nowDate);
    const infer = await runStep(inferConsumptionStep, toInferConsumptionInput(model), {
      provider: llm,
      tracer,
    });
    await upsertConsumptionModel(db, householdId, model, {
      tags: infer.value.tags,
      summary: infer.value.summary,
    });

    // 11. Budget default (only if unset — FR-HH-007) + preferences.
    if (model.medianWeeklyChequeUah != null) {
      await db
        .update(schema.households)
        .set({ weeklyBudget: model.medianWeeklyChequeUah.toFixed(2) })
        .where(
          and(
            eq(schema.households.id, householdId),
            sql`${schema.households.weeklyBudget} IS NULL`,
          ),
        );
    }
    await upsertPreferences(db, householdId, "inferred", await dislikedSlugs(db, householdId));

    await setStatus(db, householdId, "done", { bootstrappedAt: nowDate });
    void addresses;
    return { outcome: "done", orderCount: orders.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setStatus(db, householdId, "error", { bootstrapError: message }).catch(() => {});
    return { outcome: "error", message };
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function paginate<T>(
  fetch: (offset: number) => Promise<T[]>,
  pageSize: number,
  cap: number,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; offset < cap; offset += pageSize) {
    const page = await fetch(offset);
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all.slice(0, cap);
}

async function dislikedSlugs(db: Db, householdId: string): Promise<string[]> {
  const rows = await db
    .select({ code: schema.householdRestrictions.code })
    .from(schema.householdRestrictions)
    .where(
      and(
        eq(schema.householdRestrictions.householdId, householdId),
        eq(schema.householdRestrictions.kind, "dislike"),
      ),
    );
  return rows.map((r) => r.code).filter((c) => !c.startsWith("name:"));
}

async function upsertRestrictions(
  db: Db,
  householdId: string,
  restrictions: ParsedRestriction[],
  source: "mcp" | "onboarding",
): Promise<void> {
  // Validate dislike codes against the ingredient dictionary; unknown → free `name:` key.
  const dislikeCodes = restrictions.filter((r) => r.kind === "dislike").map((r) => r.code);
  const known = new Set<string>();
  if (dislikeCodes.length > 0) {
    const rows = await db
      .select({ slug: schema.canonicalIngredients.slug })
      .from(schema.canonicalIngredients)
      .where(inArray(schema.canonicalIngredients.slug, dislikeCodes));
    for (const r of rows) known.add(r.slug);
  }

  for (const r of restrictions) {
    const code =
      r.kind === "dislike" && !known.has(r.code) ? `name:${r.sourceText}`.slice(0, 200) : r.code;
    await db
      .insert(schema.householdRestrictions)
      .values({ householdId, kind: r.kind, code, severity: r.severity, source })
      .onConflictDoUpdate({
        target: [
          schema.householdRestrictions.householdId,
          schema.householdRestrictions.kind,
          schema.householdRestrictions.code,
        ],
        // Preserve a guest confirmation: only refresh severity/source, never confirmed_at.
        set: { severity: r.severity, source },
      });
  }
}

async function upsertConsumptionModel(
  db: Db,
  householdId: string,
  model: ConsumptionModel,
  infer?: { tags: string[]; summary: string },
): Promise<void> {
  await db
    .insert(schema.consumptionModels)
    .values({
      householdId,
      source: model.source,
      orderCount: model.orderCount,
      windowStart: model.window ? new Date(model.window.start) : null,
      windowEnd: model.window ? new Date(model.window.end) : null,
      medianWeeklyChequeUah:
        model.medianWeeklyChequeUah != null ? model.medianWeeklyChequeUah.toFixed(2) : null,
      model,
      inferredTags: infer?.tags ?? [],
      inferSummary: infer?.summary ?? null,
    })
    .onConflictDoUpdate({
      target: schema.consumptionModels.householdId,
      set: {
        source: model.source,
        orderCount: model.orderCount,
        windowStart: model.window ? new Date(model.window.start) : null,
        windowEnd: model.window ? new Date(model.window.end) : null,
        medianWeeklyChequeUah:
          model.medianWeeklyChequeUah != null ? model.medianWeeklyChequeUah.toFixed(2) : null,
        model,
        inferredTags: infer?.tags ?? [],
        inferSummary: infer?.summary ?? null,
        computedAt: new Date(),
      },
    });
}

async function upsertPreferences(
  db: Db,
  householdId: string,
  source: HouseholdPreferences["source"],
  dislikedIngredients: string[],
): Promise<void> {
  await db
    .insert(schema.householdPreferences)
    .values({ householdId, source, dislikedIngredients })
    .onConflictDoUpdate({
      target: schema.householdPreferences.householdId,
      set: { source, dislikedIngredients, updatedAt: new Date() },
    });
}
