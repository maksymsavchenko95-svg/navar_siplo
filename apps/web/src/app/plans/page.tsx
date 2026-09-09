"use client";

import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { pct, planTimestamp, uah } from "@/lib/format";
import {
  ArrowRight,
  PrimaryButton,
  ScreenShell,
  ScreenTitle,
  SecondaryButton,
  SpinnerDots,
} from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  draft: "чернетка",
  confirmed: "підтверджено",
  materialized: "у кошику",
  checked_out: "оформлено",
};

export default function PlansPage() {
  const router = useRouter();
  const plans = trpc.plan.list.useQuery();

  return (
    <ScreenShell>
      <ScreenTitle title="Ваші плани" sub="Однаковий seed → однаковий план." />

      {plans.isLoading && <SpinnerDots />}

      {plans.data && plans.data.length === 0 && (
        <p className="screen-sub-title">Ще немає жодного плану.</p>
      )}

      <div className="dishes-list">
        {(plans.data ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            className="dish-card"
            onClick={() => router.push(`/plan/${p.id}`)}
          >
            <div className="dish-card-header">
              <span className="dish-card-title">
                {planTimestamp(p.createdAt)}
                {" · "}
                {p.goal === "form" ? "Форма" : "Рутина"}
              </span>
              <span className="dish-day-tag">{STATUS_LABEL[p.status] ?? p.status}</span>
            </div>
            <div className="dish-meta-row">
              <span className="dish-pill-meta" style={{ fontWeight: 800 }}>
                {uah(p.totalEstUah)}
              </span>
              <span className="dish-pill-meta">з {uah(p.budgetUah)}</span>
              {p.promoSharePct != null && (
                <span className="dish-pill-promo">Акції {pct(p.promoSharePct)}</span>
              )}
              <span className="dish-pill-meta">seed {p.seed}</span>
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <PrimaryButton onClick={() => router.push("/plan")}>
          <span>Новий план</span>
          <ArrowRight />
        </PrimaryButton>
        <SecondaryButton onClick={() => router.push("/goal")}>
          Змінити ціль і бюджет
        </SecondaryButton>
      </div>
    </ScreenShell>
  );
}
