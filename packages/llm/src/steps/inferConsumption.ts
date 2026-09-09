import {
  type ConsumptionTag,
  type InferConsumptionInput,
  type InferConsumptionOutput,
  inferConsumptionOutputSchema,
} from "@navar/domain";

import { loadPrompt } from "../prompt.js";
import { defineStep } from "../step.js";

const PROMPT = loadPrompt("inferConsumption", 1);

/**
 * `inferConsumption` (TDD §6) — an interpretation layer on top of the deterministic
 * `ConsumptionModel` (ADR-02: the numbers are already computed; the LLM only adds soft
 * tags + a sentence). The deterministic fallback derives tags from thresholds on the same
 * aggregate and renders a template summary — never a health claim.
 */

const PRODUCE = new Set(["vegetable", "fruit"]);

/** Threshold-derived tags — the offline fallback. */
export function deriveTags(input: InferConsumptionInput): ConsumptionTag[] {
  const tags: ConsumptionTag[] = [];
  const cheque = input.medianWeeklyChequeUah;
  if (cheque != null && cheque > 0 && cheque < 1200) tags.push("budget_conscious");
  if (cheque != null && cheque >= 2500) tags.push("premium_leaning");

  const withCat = input.topItems.filter((i) => i.category);
  const share = (test: (c: string) => boolean) =>
    withCat.length === 0 ? 0 : withCat.filter((i) => test(i.category!)).length / withCat.length;

  if (share((c) => PRODUCE.has(c)) >= 0.35) tags.push("fresh_produce_heavy");
  if (share((c) => c === "meat" || c === "fish") >= 0.35) tags.push("meat_heavy");
  if (share((c) => c === "legume" || c === "vegetable") >= 0.5) tags.push("plant_leaning");
  if (input.topBrands.length >= 3) tags.push("brand_loyal");
  if (input.topItems.some((i) => i.buysPer4Weeks >= 4)) tags.push("batch_cooks");

  return tags.slice(0, 6);
}

function templateSummary(input: InferConsumptionInput): string {
  if (input.orderCount < 5) {
    return `Історія покупок ще коротка (${input.orderCount} чек${input.orderCount === 1 ? "" : "и"}) — портрет орієнтовний.`;
  }
  // `topItems` is already gated to genuinely-regular items by `toInferConsumptionInput`
  // (R3b) — when it is empty, don't claim "регулярно берете" anything.
  const top = input.topItems
    .slice(0, 3)
    .map((i) => i.label.trim())
    .filter(Boolean)
    .join(", ");
  const chequePart = input.medianWeeklyChequeUah
    ? ` Середній тижневий чек — близько ${Math.round(input.medianWeeklyChequeUah)} ₴.`
    : "";
  return top
    ? `Ви регулярно берете: ${top}.${chequePart}`
    : `За ${input.weeks} тиж. купівель ${input.orderCount}.${chequePart}`;
}

export const inferConsumptionStep = defineStep<InferConsumptionInput, InferConsumptionOutput>({
  name: "inferConsumption",
  promptVersion: PROMPT.version,
  schema: inferConsumptionOutputSchema,
  build: (input) => ({ system: PROMPT.text, prompt: JSON.stringify(input) }),
  fallback: (input) => ({ tags: deriveTags(input), summary: templateSummary(input) }),
});
