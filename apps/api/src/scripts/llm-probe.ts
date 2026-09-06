import { explainPlanStep, noopTracer, runStep } from "@navar/llm";

import { checkLlmHealth, getLlm } from "../llm.js";

/**
 * `pnpm --filter @navar/api llm:probe` — is the LLM actually answering? Runs the startup
 * health check, then one real `explainPlan` and prints whether the model or the fallback
 * produced the text. Deliberately imports no DB / Redis so it exits on its own.
 */
async function main(): Promise<void> {
  const health = await checkLlmHealth();
  console.log(
    `health: ${health.status} · model ${health.model}${health.message ? ` · ${health.message}` : ""}`,
  );
  if (health.status !== "ok") process.exitCode = 1;

  const at = Date.now();
  const r = await runStep(
    explainPlanStep,
    {
      days: 5,
      budgetUah: 5000,
      totalUah: 3204,
      savingsUah: 605,
      promoSharePct: 57,
      goal: "routine",
      dishes: ["Чилі з індичкою та квасолею", "Куліш з перловкою та грибами"],
    },
    { provider: getLlm(), tracer: noopTracer },
  );
  console.log(`explainPlan: source=${r.source} · ${Date.now() - at} ms`);
  if (r.source === "fallback") console.log(`reason: ${r.reason}`);
  console.log(r.value.text);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
