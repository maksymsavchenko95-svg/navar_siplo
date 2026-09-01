import {
  type ExplainPlanInput,
  type ExplainPlanOutput,
  explainPlanOutputSchema,
} from "@navar/domain";

import { loadPrompt } from "../prompt.js";
import { defineStep } from "../step.js";

const PROMPT = loadPrompt("explainPlan", 1);

/** Whole number with a plain-space thousands separator (locale-independent, testable). */
function uah(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * `explainPlan` (TDD §6) — turn a plan's headline numbers into a 2–3 sentence Guest-facing
 * note. The LLM only explains (ADR-02); the deterministic fallback is a template.
 */
export const explainPlanStep = defineStep<ExplainPlanInput, ExplainPlanOutput>({
  name: "explainPlan",
  promptVersion: PROMPT.version,
  schema: explainPlanOutputSchema,
  build: (input) => ({ system: PROMPT.text, prompt: JSON.stringify(input) }),
  fallback: (input) => {
    const parts = [
      `План на ${input.days} днів укладено в бюджет ${uah(input.budgetUah)} ₴: ` +
        `разом ${uah(input.totalUah)} ₴`,
    ];
    if (input.savingsUah > 0) parts.push(`, економія ${uah(input.savingsUah)} ₴`);
    parts.push(".");
    if (input.promoSharePct > 0) {
      parts.push(` Акційні позиції покривають ${Math.round(input.promoSharePct)}% вартості.`);
    }
    if (input.goal === "form") {
      parts.push(" Меню зібране навколо ваших цілей за білком і калоріями.");
    }
    if (input.dishes.length > 0) {
      parts.push(` Серед страв — ${input.dishes.slice(0, 2).join(", ")}.`);
    }
    return { text: parts.join("") };
  },
});
