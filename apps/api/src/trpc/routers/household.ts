import type { Db } from "@navar/db";
import { schema } from "@navar/db";
import {
  type ConsumptionModel,
  confirmTastesInputSchema,
  type HouseholdPortrait,
  type HouseholdResult,
  onboardingAnswersSchema,
  type StoredRestriction,
} from "@navar/domain";
import { parseRestrictionsStep, runStep } from "@navar/llm";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { buildPortrait } from "../../household/portrait.js";
import { resolveHouseholdId } from "../../household.js";
import { bootstrapQueue } from "../../queue/bootstrap-queue.js";
// bootstrapQueue() is lazy — constructed on first enqueue, not on import.
import { publicProcedure, router } from "../trpc.js";

const BOOTSTRAP_STATUS = ["idle", "running", "onboarding_required", "done", "error"] as const;

async function loadHousehold(db: Db, householdId: string) {
  return db.query.households.findFirst({
    where: (h, { eq: e }) => e(h.id, householdId),
    with: {
      members: true,
      restrictions: true,
      consumptionModel: true,
      preferences: true,
    },
  });
}

function toStoredRestrictions(
  rows: {
    kind: string;
    code: string;
    severity: string;
    source: string;
    confirmedAt: Date | null;
  }[],
): StoredRestriction[] {
  return rows.map((r) => ({
    kind: r.kind as StoredRestriction["kind"],
    code: r.code,
    severity: r.severity as StoredRestriction["severity"],
    source: r.source as StoredRestriction["source"],
    confirmed: r.confirmedAt !== null,
  }));
}

function portraitFrom(
  hh: NonNullable<Awaited<ReturnType<typeof loadHousehold>>>,
): HouseholdPortrait {
  const model = (hh.consumptionModel?.model ?? null) as ConsumptionModel | null;
  return buildPortrait(model, toStoredRestrictions(hh.restrictions), {
    summary: hh.consumptionModel?.inferSummary ?? null,
    tags: hh.consumptionModel?.inferredTags ?? [],
  });
}

export const householdRouter = router({
  /** Enqueue the async bootstrap job. Idempotent — `jobId = householdId` dedupes. */
  bootstrap: publicProcedure.mutation(
    async ({
      ctx,
    }): Promise<{ status: "running"; jobId: string } | { status: "error"; message: string }> => {
      const householdId = await resolveHouseholdId();
      if (!householdId) return { status: "error", message: "no household — run pnpm db:seed" };
      try {
        await ctx.db
          .update(schema.households)
          .set({ bootstrapStatus: "running", bootstrapError: null })
          .where(eq(schema.households.id, householdId));
        const job = await bootstrapQueue().add(
          "bootstrap",
          { householdId },
          { jobId: householdId, removeOnComplete: 100, removeOnFail: 100 },
        );
        return { status: "running", jobId: job.id ?? householdId };
      } catch (err) {
        return { status: "error", message: err instanceof Error ? err.message : String(err) };
      }
    },
  ),

  bootstrapStatus: publicProcedure.query(
    async ({
      ctx,
    }): Promise<{
      status: (typeof BOOTSTRAP_STATUS)[number];
      error?: string;
      orderCount?: number;
    }> => {
      const householdId = await resolveHouseholdId();
      if (!householdId) return { status: "idle" };
      const [row] = await ctx.db
        .select({
          status: schema.households.bootstrapStatus,
          error: schema.households.bootstrapError,
        })
        .from(schema.households)
        .where(eq(schema.households.id, householdId));
      const status = (row?.status ?? "idle") as (typeof BOOTSTRAP_STATUS)[number];
      if (status === "onboarding_required") {
        const [cm] = await ctx.db
          .select({ orderCount: schema.consumptionModels.orderCount })
          .from(schema.consumptionModels)
          .where(eq(schema.consumptionModels.householdId, householdId));
        return { status, orderCount: cm?.orderCount ?? 0 };
      }
      return status === "error" ? { status, error: row?.error ?? "unknown error" } : { status };
    },
  ),

  get: publicProcedure.query(async ({ ctx }): Promise<HouseholdResult> => {
    const householdId = await resolveHouseholdId();
    if (!householdId) return { status: "not_bootstrapped" };
    const hh = await loadHousehold(ctx.db, householdId);
    if (!hh) return { status: "not_bootstrapped" };
    return {
      status: "ok",
      household: {
        id: hh.id,
        goal: hh.goal as "routine" | "form",
        weeklyBudgetUah: hh.weeklyBudget != null ? Number(hh.weeklyBudget) : null,
        branchId: hh.branchId,
        deliveryType: hh.deliveryType,
        bootstrapStatus: hh.bootstrapStatus as (typeof BOOTSTRAP_STATUS)[number],
      },
      members: hh.members.map((m) => ({
        kind: m.kind as "adult" | "child" | "pet",
        ageYears: m.ageYears,
        label: m.label,
      })),
      restrictions: toStoredRestrictions(hh.restrictions),
      consumptionModel: (hh.consumptionModel?.model ?? null) as ConsumptionModel | null,
      preferences: hh.preferences
        ? {
            weeklyBudgetUah: hh.weeklyBudget != null ? Number(hh.weeklyBudget) : null,
            dislikedIngredients: hh.preferences.dislikedIngredients,
            maxPrepMinutes: hh.preferences.maxPrepMinutes,
            cookingWeekdays: hh.preferences.cookingWeekdays,
            difficultyCap: hh.preferences.difficultyCap,
            source: hh.preferences.source as "onboarding" | "inferred" | "guest",
          }
        : null,
    };
  }),

  inferredTastes: publicProcedure.query(
    async ({
      ctx,
    }): Promise<
      | { status: "ok"; portrait: HouseholdPortrait }
      | { status: "onboarding_required" }
      | { status: "not_bootstrapped" }
    > => {
      const householdId = await resolveHouseholdId();
      if (!householdId) return { status: "not_bootstrapped" };
      const hh = await loadHousehold(ctx.db, householdId);
      if (!hh || hh.bootstrapStatus === "idle") return { status: "not_bootstrapped" };
      if (hh.bootstrapStatus === "onboarding_required") return { status: "onboarding_required" };
      return { status: "ok", portrait: portraitFrom(hh) };
    },
  ),

  confirmTastes: publicProcedure
    .input(confirmTastesInputSchema)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<
        { status: "ok"; portrait: HouseholdPortrait } | { status: "not_bootstrapped" }
      > => {
        const householdId = await resolveHouseholdId();
        if (!householdId) return { status: "not_bootstrapped" };
        const disliked = new Set<string>();

        for (const edit of input.edits) {
          if (edit.action === "add") {
            await ctx.db
              .insert(schema.householdRestrictions)
              .values({
                householdId,
                kind: edit.kind,
                code: edit.code,
                severity: edit.severity,
                source: "guest",
                confirmedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  schema.householdRestrictions.householdId,
                  schema.householdRestrictions.kind,
                  schema.householdRestrictions.code,
                ],
                set: { severity: edit.severity, source: "guest", confirmedAt: new Date() },
              });
            continue;
          }
          const parsed = parseCardId(edit.id);
          if (parsed?.type === "restriction") {
            if (edit.action === "reject") {
              await ctx.db
                .delete(schema.householdRestrictions)
                .where(
                  and(
                    eq(schema.householdRestrictions.householdId, householdId),
                    eq(schema.householdRestrictions.kind, parsed.kind),
                    eq(schema.householdRestrictions.code, parsed.code),
                  ),
                );
            } else {
              await ctx.db
                .update(schema.householdRestrictions)
                .set({
                  confirmedAt: new Date(),
                  ...(edit.action === "edit" ? { severity: edit.severity } : {}),
                })
                .where(
                  and(
                    eq(schema.householdRestrictions.householdId, householdId),
                    eq(schema.householdRestrictions.kind, parsed.kind),
                    eq(schema.householdRestrictions.code, parsed.code),
                  ),
                );
            }
          } else if (parsed?.type === "item" && edit.action === "reject" && parsed.slug) {
            disliked.add(parsed.slug);
          }
        }

        if (disliked.size > 0) {
          const [pref] = await ctx.db
            .select({ list: schema.householdPreferences.dislikedIngredients })
            .from(schema.householdPreferences)
            .where(eq(schema.householdPreferences.householdId, householdId));
          const merged = [...new Set([...(pref?.list ?? []), ...disliked])];
          await ctx.db
            .insert(schema.householdPreferences)
            .values({ householdId, source: "guest", dislikedIngredients: merged })
            .onConflictDoUpdate({
              target: schema.householdPreferences.householdId,
              set: { dislikedIngredients: merged, source: "guest", updatedAt: new Date() },
            });
        }

        const hh = await loadHousehold(ctx.db, householdId);
        return { status: "ok", portrait: portraitFrom(hh!) };
      },
    ),

  submitOnboarding: publicProcedure
    .input(onboardingAnswersSchema)
    .mutation(async ({ ctx, input }): Promise<{ status: "ok" }> => {
      const householdId = await resolveHouseholdId();
      if (!householdId) throw new Error("no household");

      const parsed = await runStep(
        parseRestrictionsStep,
        { phrases: [...input.restrictionPhrases, ...input.dislikedPhrases].slice(0, 50) },
        { provider: ctx.llm, tracer: ctx.tracer },
      );

      // Members from the answers.
      await ctx.db
        .delete(schema.householdMembers)
        .where(eq(schema.householdMembers.householdId, householdId));
      const memberRows = [
        ...Array.from({ length: input.adults }, () => ({
          householdId,
          kind: "adult",
          ageYears: null as number | null,
          label: null as string | null,
        })),
        ...input.children.map((age) => ({
          householdId,
          kind: "child",
          ageYears: age,
          label: null,
        })),
      ];
      await ctx.db.insert(schema.householdMembers).values(memberRows);

      // Restrictions (guest-entered → confirmed).
      for (const r of parsed.value.restrictions) {
        await ctx.db
          .insert(schema.householdRestrictions)
          .values({
            householdId,
            kind: r.kind,
            code: r.kind === "dislike" ? r.code : r.code,
            severity: r.severity,
            source: "onboarding",
            confirmedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              schema.householdRestrictions.householdId,
              schema.householdRestrictions.kind,
              schema.householdRestrictions.code,
            ],
            set: { severity: r.severity, source: "onboarding", confirmedAt: new Date() },
          });
      }

      // Budget (guest-explicit, FR-HH-007) + status.
      await ctx.db
        .update(schema.households)
        .set({
          ...(input.weeklyBudgetUah != null
            ? { weeklyBudget: input.weeklyBudgetUah.toFixed(2) }
            : {}),
          bootstrapStatus: "done",
          bootstrappedAt: new Date(),
        })
        .where(eq(schema.households.id, householdId));

      // Onboarding consumption model + preferences.
      await ctx.db
        .insert(schema.consumptionModels)
        .values({
          householdId,
          source: "onboarding",
          orderCount: 0,
          medianWeeklyChequeUah:
            input.weeklyBudgetUah != null ? input.weeklyBudgetUah.toFixed(2) : null,
          model: {
            source: "onboarding",
            orderCount: 0,
            window: null,
            medianWeeklyChequeUah: input.weeklyBudgetUah,
            buyFrequency: [],
            brandAffinity: [],
          },
        })
        .onConflictDoUpdate({
          target: schema.consumptionModels.householdId,
          set: {
            source: "onboarding",
            orderCount: 0,
            medianWeeklyChequeUah:
              input.weeklyBudgetUah != null ? input.weeklyBudgetUah.toFixed(2) : null,
            computedAt: new Date(),
          },
        });

      await ctx.db
        .insert(schema.householdPreferences)
        .values({
          householdId,
          source: "onboarding",
          dislikedIngredients: parsed.value.restrictions
            .filter((r) => r.kind === "dislike")
            .map((r) => r.code),
          cookingWeekdays: input.cookingWeekdays,
          maxPrepMinutes: input.maxPrepMinutes,
        })
        .onConflictDoUpdate({
          target: schema.householdPreferences.householdId,
          set: {
            source: "onboarding",
            cookingWeekdays: input.cookingWeekdays,
            maxPrepMinutes: input.maxPrepMinutes,
            updatedAt: new Date(),
          },
        });

      return { status: "ok" };
    }),
});

// ─── card id parsing ──────────────────────────────────────────────────────────

const KIND = z.enum(["allergen", "diet", "dislike"]);

export function parseCardId(
  id: string,
):
  | { type: "restriction"; kind: "allergen" | "diet" | "dislike"; code: string }
  | { type: "item"; slug: string | null }
  | null {
  if (id.startsWith("restriction:")) {
    const [, kind, ...rest] = id.split(":");
    const k = KIND.safeParse(kind);
    return k.success ? { type: "restriction", kind: k.data, code: rest.join(":") } : null;
  }
  if (id.startsWith("often:") || id.startsWith("rarely:")) {
    const key = id.slice(id.indexOf(":") + 1);
    return { type: "item", slug: key.includes(":") ? null : key };
  }
  return null;
}
