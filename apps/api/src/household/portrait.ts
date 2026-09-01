/**
 * Deterministic household portrait (`FR-HH-004`, `AC-P0-02`, roadmap T1.4). Turns the
 * `ConsumptionModel` + stored restrictions into the assumption cards the guest confirms.
 * Pure — no LLM (the optional `inferConsumption` summary/tags are threaded through by the
 * caller). Tested in `portrait.test.ts`.
 */

import type {
  ConsumptionModel,
  HouseholdPortrait,
  StoredRestriction,
  TasteCard,
} from "@navar/domain";

const OFTEN_MIN_ORDER_SHARE = 0.25;
const OFTEN_MAX_CARDS = 8;

function freq(buysPer4Weeks: number): string {
  if (buysPer4Weeks >= 3.5) return "щотижня";
  if (buysPer4Weeks >= 1.5) return "раз на два тижні";
  if (buysPer4Weeks >= 0.7) return "раз на місяць";
  return "зрідка";
}

function restrictionCard(r: StoredRestriction): TasteCard {
  const kind = r.kind === "allergen" ? "allergy" : r.kind === "diet" ? "diet" : "dislike";
  const detail =
    r.kind === "dislike"
      ? "Не додаємо у страви"
      : r.severity === "strict"
        ? "Суворе виключення"
        : "Мʼяке обмеження";
  return {
    id: `restriction:${r.kind}:${r.code}`,
    kind,
    label: r.code,
    detail,
    code: r.code,
    severity: r.severity,
    source: r.source,
    confirmed: r.confirmed,
  };
}

export function buildPortrait(
  model: ConsumptionModel | null,
  restrictions: StoredRestriction[],
  infer?: { summary: string | null; tags: string[] },
): HouseholdPortrait {
  const bf = model?.buyFrequency ?? [];

  const oftenBought: TasteCard[] = bf
    .filter((b) => b.orderShare >= OFTEN_MIN_ORDER_SHARE)
    .slice(0, OFTEN_MAX_CARDS)
    .map((b) => ({
      id: `often:${b.key}`,
      kind: "often_bought" as const,
      label: b.label,
      detail: freq(b.buysPer4Weeks),
      code: b.key.includes(":") ? null : b.key,
      severity: null,
      source: "receipts" as const,
      confirmed: false,
    }));

  // Weak P0 rarely-bought: bought once, a while ago. (Follow-up: corpus staples never bought.)
  const rarelyBought: TasteCard[] = bf
    .filter((b) => b.orderShare < 0.15 && (b.lastBoughtDaysAgo ?? 0) > 45)
    .slice(0, 6)
    .map((b) => ({
      id: `rarely:${b.key}`,
      kind: "rarely_bought" as const,
      label: b.label,
      detail: "Схоже, беруть зрідка",
      code: b.key.includes(":") ? null : b.key,
      severity: null,
      source: "receipts" as const,
      confirmed: false,
    }));

  return {
    isAssumption: true,
    summary: infer?.summary ?? null,
    tags: infer?.tags ?? [],
    oftenBought,
    rarelyBought,
    allergies: restrictions.map(restrictionCard),
  };
}
