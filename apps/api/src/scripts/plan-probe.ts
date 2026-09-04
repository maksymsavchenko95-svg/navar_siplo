import { closeDb, getPlanDetail } from "@navar/db";
import type { Goal } from "@navar/domain";
import { generatePlan } from "@navar/planner";

import { resolveHouseholdId } from "../household.js";
import { buildSolverInput, generateAndPersistPlan } from "../plan.js";
import { getSilpoProvider } from "../retail.js";

/**
 * `pnpm --filter @navar/api plan:probe [--goal routine|form] [--budget N] [--seed N] [--days N] [--persist]`
 * — Demo-1 console command (`AC-P0-03`, `AC-P0-09`). Builds a `SolverInput` for the resolved
 * household, runs the solver, prints the plan + totals, and runs it twice to prove
 * determinism. `--persist` also runs `plan.generate` (persist + `explainPlan`) and prints a
 * `plan.get` round-trip. Needs `pnpm mcp:auth` for real prices; degrades to an infeasible
 * plan without it.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const householdId = await resolveHouseholdId();
  if (!householdId) {
    console.error("no household — run pnpm db:seed");
    process.exitCode = 1;
    return;
  }

  const opts = {
    goal: arg("goal") as Goal | undefined,
    budgetUah: arg("budget") ? Number(arg("budget")) : undefined,
    seed: arg("seed") ? Number(arg("seed")) : undefined,
    days: arg("days") ? Number(arg("days")) : undefined,
  };

  const retail = await getSilpoProvider();
  const input = await buildSolverInput(householdId, retail, opts);
  console.log(
    `goal=${input.goal} budget=${input.budget}₴ servings=${input.servings} seed=${input.seed} ` +
      `candidates=${input.candidates.length} priced=${input.prices.size}` +
      (input.hardConstraints.proteinMinPerDay
        ? ` protein≥${input.hardConstraints.proteinMinPerDay}g/dinner kcal∈[${input.hardConstraints.kcalRange?.join(", ")}]`
        : ""),
  );

  const col = (s: string, n: number) => s.slice(0, n).padEnd(n);

  const result = generatePlan(input);
  if (!result.feasible) {
    console.log(
      `\n⚠️  infeasible · binding=${result.binding}` +
        (result.shortfallUah != null ? ` · +${result.shortfallUah} ₴` : "") +
        (result.shortfallProteinG != null ? ` · −${result.shortfallProteinG} г білка` : ""),
    );
    console.log(`   ${result.reason}`);
    if (result.nearest) {
      console.log("\n   найближчий валідний план:");
      for (const d of result.nearest.days) {
        console.log(
          `   ${col(String(d.day), 3)}${col(d.titleUk, 34)}${col(`${d.costUah}₴`, 9)}` +
            `${Math.round(d.macrosPerServing.protein)}g`,
        );
      }
      console.log(`   Σ ${result.nearest.totals.costUah}₴ (бюджет ${input.budget}₴)`);
    }
    // Same seed → identical enriched result (AC-P0-09).
    const again = generatePlan(input);
    console.log(
      JSON.stringify(result) === JSON.stringify(again)
        ? `✅ deterministic (seed ${input.seed})`
        : "❌ non-deterministic",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "\n" +
      col("day", 4) +
      col("dish", 34) +
      col("portion", 8) +
      col("cost", 9) +
      col("promo₴", 9) +
      col("kcal", 7) +
      "protein",
  );
  for (const d of result.days) {
    console.log(
      col(String(d.day), 4) +
        col(d.titleUk, 34) +
        col(`${d.portionScale.toFixed(2)}×`, 8) +
        col(`${d.costUah}₴`, 9) +
        col(`${d.promoShareUah}₴`, 9) +
        col(String(Math.round(d.macrosPerServing.kcal)), 7) +
        `${Math.round(d.macrosPerServing.protein)}g`,
    );
  }
  const t = result.totals;
  console.log(
    `\nΣ ${t.costUah}₴ / ${t.budgetUah}₴ · promo ${t.promoSharePct}% · ` +
      `protein-floor ${t.proteinFloorMet ? "✅" : "❌"} · kcal-corridor ${t.kcalCorridorMet ? "✅" : "❌"}`,
  );
  const withinBudget = t.costUah <= t.budgetUah;
  console.log(withinBudget ? "✅ within budget (AC-P0-03)" : "⚠️  over budget");

  // determinism (AC-P0-09)
  const again = generatePlan(input);
  const same = JSON.stringify(result) === JSON.stringify(again);
  console.log(same ? `✅ deterministic (seed ${input.seed})` : "❌ non-deterministic");
  if (!withinBudget || !same) process.exitCode = 1;

  if (flag("persist")) {
    console.log("\n── persist (plan.generate + explainPlan) ──");
    const gen = await generateAndPersistPlan(householdId, retail, opts);
    if (gen.status !== "ok") {
      console.log(`⚠️  ${gen.status}${"reason" in gen ? ` — ${gen.reason}` : ""}`);
      process.exitCode = 1;
      return;
    }
    const saved = await getPlanDetail(gen.planId, householdId);
    if (!saved) {
      console.log("❌ plan.get returned null");
      process.exitCode = 1;
      return;
    }
    console.log(
      `planId ${gen.planId}  ·  ${saved.items.length} dinners  ·  ${saved.list.length} list lines`,
    );
    console.log(
      `Σ ${saved.totalEstUah}₴  promo ${saved.promoSharePct?.toFixed(0)}%  ` +
        `unpriced ${saved.unpricedLineCount}  needs-confirm ${saved.list.filter((l) => l.needsConfirmation).length}`,
    );
    console.log(`explanation: ${saved.explanation}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
