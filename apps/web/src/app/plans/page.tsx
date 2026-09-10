"use client";

import { useState } from "react";
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
  const utils = trpc.useUtils();
  const plans = trpc.plan.list.useQuery();
  const del = trpc.plan.delete.useMutation({
    onSettled: () => void utils.plan.list.invalidate(),
  });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const open = (id: string) => router.push(`/plan/${id}`);

  return (
    <ScreenShell>
      <ScreenTitle title="Ваші плани" sub="Однаковий seed → однаковий план." />

      {plans.isLoading && <SpinnerDots />}

      {plans.data && plans.data.length === 0 && (
        <p className="screen-sub-title">Ще немає жодного плану.</p>
      )}

      <div className="dishes-list">
        {(plans.data ?? []).map((p) => (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            className="dish-card"
            onClick={() => open(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open(p.id);
              }
            }}
          >
            <div className="dish-card-header">
              <span className="dish-card-title">
                {planTimestamp(p.createdAt)}
                {" · "}
                {p.goal === "form" ? "Форма" : "Рутина"}
              </span>
              <div className="dish-card-header-actions">
                <span className="dish-day-tag">{STATUS_LABEL[p.status] ?? p.status}</span>
                {confirmingId === p.id ? (
                  <>
                    <button
                      type="button"
                      className="chip-remove-btn"
                      disabled={del.isPending}
                      title="Видалити план"
                      onClick={(e) => {
                        e.stopPropagation();
                        del.mutate({ planId: p.id });
                        setConfirmingId(null);
                      }}
                    >
                      Видалити
                    </button>
                    <button
                      type="button"
                      className="chip-remove-btn"
                      title="Скасувати"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingId(null);
                      }}
                    >
                      ↩
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="chip-remove-btn"
                    title="Видалити план"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingId(p.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
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
          </div>
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
