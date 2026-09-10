import type { PlanGenStage } from "@navar/domain";

import { connection } from "./queue/connection.js";

/**
 * `plan.generate` progress breadcrumb (T4.5). `plan.generate` stays synchronous; the handler
 * writes the current stage here at each pipeline boundary and the generate screen polls
 * `plan.generationStage` (every ~1.2 s while the mutation is in flight) so the progress card
 * shows real stages instead of `Math.floor(elapsed / 6)`.
 *
 * One key per household (a Guest runs one generation at a time). Best-effort — a Redis blip
 * degrades the UI to the time-based fallback, never fails the plan. Short TTL so a crashed
 * generation's stage self-clears.
 */

const PREFIX = "navar:plan:gen:";
const TTL_S = 120;

export async function setGenStage(householdId: string, stage: PlanGenStage): Promise<void> {
  try {
    await connection.set(
      PREFIX + householdId,
      JSON.stringify({ stage, at: Date.now() }),
      "EX",
      TTL_S,
    );
  } catch {
    // best-effort — the UI falls back to the time heuristic
  }
}

export async function readGenStage(householdId: string): Promise<PlanGenStage | null> {
  try {
    const raw = await connection.get(PREFIX + householdId);
    if (!raw) return null;
    return (JSON.parse(raw) as { stage: PlanGenStage }).stage;
  } catch {
    return null;
  }
}

export async function clearGenStage(householdId: string): Promise<void> {
  try {
    await connection.del(PREFIX + householdId);
  } catch {
    // best-effort
  }
}
