import type { PlanChange, PlanDetail, PlanEditResult } from "@navar/domain";
import { describe, expect, it } from "vitest";

import { planEditFeedback } from "./plan-edit-feedback";

const change = { note: "Замінили борщ на суп — на 40 ₴ дешевше." } as PlanChange;
const plan = {} as PlanDetail;

const cases: [PlanEditResult, ReturnType<typeof planEditFeedback>][] = [
  [
    { status: "ok", plan, change },
    { kind: "toast", note: change.note },
  ],
  [{ status: "auth_required" }, { kind: "banner", banner: "auth_required" }],
  [{ status: "no_cart" }, { kind: "banner", banner: "no_cart" }],
  [{ status: "not_found" }, { kind: "banner", banner: "not_found" }],
  [
    { status: "already_materialized", reason: "вже в кошику" },
    { kind: "error", message: "вже в кошику" },
  ],
  [
    { status: "rejected", reason: "не по бюджету" },
    { kind: "error", message: "не по бюджету" },
  ],
  [
    { status: "infeasible", binding: "budget", reason: "найдешевший план — 900 ₴" },
    { kind: "error", message: "найдешевший план — 900 ₴" },
  ],
  [
    { status: "error", message: "boom" },
    { kind: "error", message: "boom" },
  ],
];

describe("planEditFeedback", () => {
  it.each(cases)("maps %o", (result, expected) => {
    expect(planEditFeedback(result)).toEqual(expected);
  });

  it("covers every PlanEditResult status (no silent no-op)", () => {
    const statuses = new Set(cases.map(([r]) => r.status));
    expect([...statuses].sort()).toEqual(
      [
        "already_materialized",
        "auth_required",
        "error",
        "infeasible",
        "no_cart",
        "not_found",
        "ok",
        "rejected",
      ].sort(),
    );
  });
});
