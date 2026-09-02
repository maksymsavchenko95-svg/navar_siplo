import { closeDb } from "@navar/db";
import type { Goal } from "@navar/domain";
import { generatePlan } from "@navar/planner";

import { resolveHouseholdId } from "../household.js";
import { buildSolverInput } from "../plan.js";
import { getSilpoProvider } from "../retail.js";

/**
 * `pnpm --filter @navar/api plan:probe [--goal routine|form] [--budget N] [--seed N] [--days N]`
 * — Demo-1 console command (`AC-P0-03`, `AC-P0-09`). Builds a `SolverInput` for the resolved
 * household, runs the solver, prints the plan + totals, and runs it twice to prove
 * determinism. Needs `pnpm mcp:auth` for real prices; degrades to an infeasible plan
 * without it.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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

  const result = generatePlan(input);
  if (!result.feasible) {
    console.log(`\n⚠️  infeasible — ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  const col = (s: string, n: number) => s.slice(0, n).padEnd(n);
  console.log(
    "\n" +
      col("day", 4) +
      col("dish", 34) +
      col("cost", 9) +
      col("promo₴", 9) +
      col("kcal", 7) +
      "protein",
  );
  for (const d of result.days) {
    console.log(
      col(String(d.day), 4) +
        col(d.titleUk, 34) +
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
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
