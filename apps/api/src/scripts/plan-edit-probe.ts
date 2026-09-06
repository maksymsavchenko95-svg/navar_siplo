import { closeDb, getPlanDetail } from "@navar/db";

import { connection } from "../queue/connection.js";
import type { Goal } from "@navar/domain";

import { resolveHouseholdId } from "../household.js";
import { applyReplacement, makeCheaper, proposeReplacements } from "../plan-edit.js";
import { generateAndPersistPlan } from "../plan.js";
import { getRetail } from "../retail.js";

/**
 * `pnpm --filter @navar/api plan:edit-probe [--household id] [--plan id | --generate]
 *   [--goal g] [--budget N] [--day N] [--cheaper N]`
 *
 * T4.2 console demo (`FR-PLAN-007/008`): a persisted plan → `plan.replaceItem` (3
 * alternatives) → `plan.applyReplacement` → `plan.cheaper`, printing before/after totals,
 * promo share, the change note, and — the actual acceptance bar — **wall-clock timings**
 * against `NFR-PERF-003` (item replacement p95 < 8 s).
 *
 * Edits the demo household's plan rows in the local DB. Touches no Silpo cart.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const col = (s: string, n: number): string => s.slice(0, n).padEnd(n);

const BUDGET_MS = 8000; // NFR-PERF-003

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const at = Date.now();
  const out = await fn();
  const ms = Date.now() - at;
  const verdict = ms <= BUDGET_MS ? "✅" : "⚠️ ";
  console.log(`   ${verdict} ${label}: ${ms} ms${ms > BUDGET_MS ? ` (over ${BUDGET_MS} ms)` : ""}`);
  return out;
}

async function main(): Promise<void> {
  const householdId = arg("household") ?? (await resolveHouseholdId());
  if (!householdId) {
    console.error("no household — run pnpm db:seed (or pass --household <id>)");
    process.exitCode = 1;
    return;
  }
  const retail = getRetail(householdId);

  let planId = arg("plan");
  if (!planId) {
    console.log("── generate ──");
    const gen = await timed("plan.generate", () =>
      generateAndPersistPlan(householdId, retail, {
        goal: arg("goal") as Goal | undefined,
        budgetUah: arg("budget") ? Number(arg("budget")) : undefined,
      }),
    );
    if (gen.status !== "ok") {
      console.log(`⚠️  plan.generate → ${gen.status}${"reason" in gen ? ` — ${gen.reason}` : ""}`);
      process.exitCode = 1;
      return;
    }
    planId = gen.planId;
  }
  console.log(`plan ${planId}\n`);

  const before = await getPlanDetail(planId, householdId);
  if (!before) {
    console.error("plan not found for this household");
    process.exitCode = 1;
    return;
  }
  console.log("── before ──");
  for (const i of before.items) {
    console.log(`  ${i.dayIndex}  ${col(i.titleUk, 34)} ${i.costUah}₴  ×${i.portionScale}`);
  }
  console.log(
    `  Σ ${before.totalEstUah}₴ / ${before.budgetUah}₴ · promo ${before.promoSharePct?.toFixed(1)}% · ${before.list.length} list lines\n`,
  );

  const day = Number(arg("day") ?? 3);
  console.log(`── plan.replaceItem (day ${day}) ──`);
  const props = await timed("replaceItem", () =>
    proposeReplacements(planId!, householdId, day, retail),
  );
  if (props.status !== "ok") {
    console.log(`⚠️  ${props.status}`);
    process.exitCode = 1;
    return;
  }
  console.log(`   current: ${props.current?.titleUk ?? "—"}`);
  if (props.alternatives.length === 0) {
    console.log("   no valid alternatives (corpus too small or budget too tight)");
  }
  for (const a of props.alternatives) {
    const sign = a.deltaUah >= 0 ? "+" : "";
    console.log(
      `   • ${col(a.titleUk, 32)} ${sign}${a.deltaUah}₴  → Σ ${a.totalUah}₴  promo ${a.promoSharePct}%`,
    );
  }

  const pick = props.alternatives[0];
  if (pick) {
    console.log(`\n── plan.applyReplacement (${pick.titleUk}) ──`);
    const applied = await timed("applyReplacement", () =>
      applyReplacement(planId!, householdId, day, pick.recipeId, retail),
    );
    if (applied.status !== "ok") {
      console.log(`⚠️  ${applied.status}${"reason" in applied ? ` — ${applied.reason}` : ""}`);
    } else {
      console.log(
        `   Σ ${applied.change.totalBeforeUah}₴ → ${applied.change.totalAfterUah}₴ · ` +
          `promo ${applied.change.promoSharePctBefore.toFixed(1)}% → ${applied.change.promoSharePctAfter.toFixed(1)}% · ` +
          `${applied.plan.list.length} list lines (recomputed)`,
      );
      console.log(`   «${applied.change.note}»`);
    }
  }

  const delta = Number(arg("cheaper") ?? 300);
  console.log(`\n── plan.cheaper (−${delta} ₴) ──`);
  const cheaper = await timed("cheaper", () => makeCheaper(planId!, householdId, delta, retail));
  if (cheaper.status === "ok") {
    for (const i of cheaper.plan.items) {
      console.log(`  ${i.dayIndex}  ${col(i.titleUk, 34)} ${i.costUah}₴  ×${i.portionScale}`);
    }
    console.log(
      `   Σ ${cheaper.change.totalBeforeUah}₴ → ${cheaper.change.totalAfterUah}₴ ` +
        `(бюджет ${cheaper.change.budgetAfterUah}₴) · changed days [${cheaper.change.changedDays.join(", ")}]`,
    );
    console.log(`   «${cheaper.change.note}»`);
    const fits = cheaper.change.totalAfterUah <= cheaper.change.budgetAfterUah;
    console.log(`   ${fits ? "✅" : "❌"} within the lowered budget`);
  } else {
    console.log(
      `   ${cheaper.status}${"reason" in cheaper ? ` — ${cheaper.reason}` : ""}` +
        ("shortfallUah" in cheaper && cheaper.shortfallUah != null
          ? ` (shortfall ${cheaper.shortfallUah}₴)`
          : ""),
    );
  }

  if (flag("twice")) {
    // Determinism: the same plan + the same delta must land on the same result.
    console.log("\n── determinism: cheaper again with the same delta ──");
    const again = await makeCheaper(planId, householdId, delta, retail);
    const same =
      again.status === cheaper.status &&
      (again.status !== "ok" ||
        cheaper.status !== "ok" ||
        JSON.stringify(again.plan.items.map((i) => i.slug)) ===
          JSON.stringify(cheaper.plan.items.map((i) => i.slug)));
    console.log(`   ${same ? "✅" : "❌"} same dishes`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // The plan-context cache opens the shared Redis socket, which would otherwise keep the
    // event loop alive forever (`cart:probe` never hits Redis, so it doesn't need this).
    await closeDb();
    await connection.quit();
  });
