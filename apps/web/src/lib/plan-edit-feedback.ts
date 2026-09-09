import type { PlanEditResult } from "@navar/domain";

/** Exactly one piece of Guest feedback for a `plan.cheaper` / `plan.applyReplacement` result. */
export type PlanEditFeedback =
  | { kind: "toast"; note: string }
  | { kind: "error"; message: string }
  | { kind: "banner"; banner: "auth_required" | "no_cart" | "not_found" };

/**
 * Map every `PlanEditResult` variant to one feedback. The plan page used to branch on only
 * 5 of the 8 statuses, so an `auth_required` / `no_cart` / `not_found` result left the
 * "Дешевше на N ₴" and "Замінити" actions looking like dead buttons.
 */
export function planEditFeedback(r: PlanEditResult): PlanEditFeedback {
  switch (r.status) {
    case "ok":
      return { kind: "toast", note: r.change.note };
    case "auth_required":
    case "no_cart":
    case "not_found":
      return { kind: "banner", banner: r.status };
    case "already_materialized":
    case "rejected":
    case "infeasible":
      return { kind: "error", message: r.reason };
    case "error":
      return { kind: "error", message: r.message };
  }
}
