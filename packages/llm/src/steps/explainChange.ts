import {
  type ExplainChangeInput,
  type ExplainPlanOutput,
  explainPlanOutputSchema,
} from "@navar/domain";

import { loadPrompt } from "../prompt.js";
import { defineStep } from "../step.js";

const PROMPT = loadPrompt("explainChange", 1);

/** Whole number with a plain-space thousands separator (locale-independent, testable). */
function uah(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * `explainChange` (T4.2, `FR-PLAN-008`) — a Guest-facing note for a plan *edit*.
 *
 * A sibling of `explainPlan` rather than an extension of it: `ExplainPlanInput` describes a
 * snapshot and has no vocabulary for a before/after, so it cannot say what changed. Output
 * shares `explainPlanOutputSchema` — both produce one short note.
 *
 * The LLM only explains (ADR-02); the fallback below is deterministic and always available
 * (`INT-LLM-003`), so an LLM outage degrades the wording, never the edit.
 */
export const explainChangeStep = defineStep<ExplainChangeInput, ExplainPlanOutput>({
  name: "explainChange",
  promptVersion: PROMPT.version,
  schema: explainPlanOutputSchema,
  build: (input) => ({ system: PROMPT.text, prompt: JSON.stringify(input) }),
  fallback: (input) => {
    const diff = input.totalAfterUah - input.totalBeforeUah;
    const parts: string[] = [];

    if (input.kind === "replace_item") {
      const from = input.removedDishes[0];
      const to = input.addedDishes[0];
      parts.push(from && to ? `Замінили «${from}» на «${to}».` : "Оновили одну страву в плані.");
    } else {
      parts.push(`Перебудували план під бюджет ${uah(input.budgetAfterUah)} ₴.`);
    }

    if (Math.round(Math.abs(diff)) === 0) {
      parts.push(` Разом — ${uah(input.totalAfterUah)} ₴, як і було.`);
    } else {
      parts.push(
        ` Разом — ${uah(input.totalAfterUah)} ₴, це на ${uah(diff)} ₴ ` +
          `${diff < 0 ? "дешевше" : "дорожче"}.`,
      );
    }

    const promoMoved = Math.round(input.promoSharePctAfter) - Math.round(input.promoSharePctBefore);
    if (Math.abs(promoMoved) >= 5) {
      parts.push(` Частка акційних позицій — ${Math.round(input.promoSharePctAfter)}%.`);
    }
    return { text: parts.join("") };
  },
});
