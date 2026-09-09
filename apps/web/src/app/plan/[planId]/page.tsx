"use client";

import type { PlanDetail, PlanEditResult } from "@navar/domain";
import { use, useState } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { useReconnect } from "@/lib/auth";
import { approx, minutes, pct, uah } from "@/lib/format";
import { planEditFeedback } from "@/lib/plan-edit-feedback";
import { ReplaceSheet } from "@/components/plan/ReplaceSheet";
import {
  NoCartBanner,
  PrimaryButton,
  ReconnectBanner,
  ScreenShell,
  ScreenTitle,
  SecondaryButton,
  SpinnerDots,
  StateBanner,
} from "@/components/ui";

const CHEAPER_STEPS = [100, 300, 500];
const DISCLAIMER =
  "Navar не є медичним сервісом. За критичних алергій перевіряйте склад на упаковці.";

export default function PlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();

  const reconnect = useReconnect();

  const plan = trpc.plan.get.useQuery({ planId });
  const [sheetDay, setSheetDay] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBanner, setEditBanner] = useState<"auth_required" | "no_cart" | "not_found" | null>(
    null,
  );

  const clearEditFeedback = () => {
    setToast(null);
    setEditError(null);
    setEditBanner(null);
  };

  const onEditResult = (r: PlanEditResult) => {
    setSheetDay(null);
    clearEditFeedback();
    const fb = planEditFeedback(r);
    if (fb.kind === "toast") {
      setToast(fb.note);
      void utils.plan.get.invalidate({ planId });
    } else if (fb.kind === "banner") {
      setEditBanner(fb.banner);
    } else {
      setEditError(fb.message);
    }
  };

  const onEditError = (e: { message: string }) => {
    setSheetDay(null);
    clearEditFeedback();
    setEditError(e.message || "Не вдалося застосувати зміну. Спробуйте ще раз.");
  };

  const applyReplacement = trpc.plan.applyReplacement.useMutation({
    onSuccess: onEditResult,
    onError: onEditError,
  });
  const cheaper = trpc.plan.cheaper.useMutation({
    onSuccess: onEditResult,
    onError: onEditError,
  });

  if (plan.isLoading) {
    return (
      <ScreenShell step={4} back="/plans">
        <SpinnerDots />
      </ScreenShell>
    );
  }
  if (plan.data?.status !== "ok") {
    return (
      <ScreenShell step={4} back="/plans">
        <StateBanner title="План не знайдено">
          Можливо, його видалили. <button onClick={() => router.push("/plans")}>До списку</button>
        </StateBanner>
      </ScreenShell>
    );
  }

  const p = plan.data.plan;
  const locked = p.status === "materialized" || p.status === "checked_out";
  const busy = applyReplacement.isPending || cheaper.isPending;

  return (
    <ScreenShell step={4} back="/plans">
      <PlanHero plan={p} />

      {p.explanation && (
        <p className="plan-explanation">
          {p.explanation}{" "}
          <span className="plan-explanation__src">
            {p.explanationSource === "llm" ? "· згенеровано ШІ" : "· шаблон"}
          </span>
        </p>
      )}

      {editBanner === "auth_required" && <ReconnectBanner onReconnect={reconnect} />}
      {editBanner === "no_cart" && <NoCartBanner />}
      {editBanner === "not_found" && (
        <StateBanner title="План не знайдено">
          Можливо, його видалили.{" "}
          <button onClick={() => router.push("/plans")}>До списку планів</button>
        </StateBanner>
      )}
      {editError && <StateBanner title="Зміну не застосовано">{editError}</StateBanner>}
      {toast && <StateBanner tone="info">{toast}</StateBanner>}

      <div className="dishes-list">
        {p.items.map((item) => {
          const openRecipe = () => router.push(`/plan/${planId}/day/${item.dayIndex}`);
          return (
            <div
              key={item.dayIndex}
              role="button"
              tabIndex={0}
              className={`dish-card ${locked ? "is-locked" : ""}`}
              onClick={openRecipe}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openRecipe();
                }
              }}
            >
              <div className="dish-card-header">
                <span className="dish-card-title">{item.titleUk}</span>
                <span className="dish-day-tag">День {item.dayIndex}</span>
              </div>
              <div className="dish-meta-row">
                {item.totalMinutes != null && (
                  <span className="dish-pill-meta">{minutes(item.totalMinutes)}</span>
                )}
                <span
                  className="dish-pill-meta"
                  style={{ fontWeight: 800, color: "var(--color-text-hero)" }}
                >
                  {uah(item.costUah)}
                </span>
                {item.macrosPerServing && (
                  <span className="dish-pill-protein">
                    {Math.round(item.macrosPerServing.protein)} г білка · за порцію
                  </span>
                )}
                {item.promoShareUah > 0 && <span className="dish-pill-promo">Акція</span>}
                {p.goal === "form" && item.portionScale !== 1 && (
                  <span className="dish-pill-meta">×{item.portionScale.toFixed(2)}</span>
                )}
              </div>
              {!locked && (
                <button
                  type="button"
                  className="dish-card__replace"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSheetDay(item.dayIndex);
                  }}
                >
                  Замінити
                </button>
              )}
            </div>
          );
        })}
      </div>

      {locked ? (
        <StateBanner tone="warn">
          План уже в кошику «Сільпо». Створіть новий план, щоб змінити меню.
        </StateBanner>
      ) : (
        <div className="chip-row">
          {CHEAPER_STEPS.map((d) => (
            <button
              key={d}
              type="button"
              className="chip-choice"
              disabled={busy}
              onClick={() => cheaper.mutate({ planId, deltaUah: d })}
            >
              Дешевше на {uah(d)}
            </button>
          ))}
        </div>
      )}

      <p className="cart-retailer-note">{DISCLAIMER}</p>

      <div className="plan-pinned-actions">
        <PrimaryButton onClick={() => router.push(`/plan/${planId}/cart`)}>
          <span>Зібрати кошик</span>
        </PrimaryButton>
        <SecondaryButton onClick={() => router.push(`/plan/${planId}/trace`)}>
          Як це працювало
        </SecondaryButton>
      </div>

      {sheetDay != null && (
        <ReplaceSheet
          planId={planId}
          day={sheetDay}
          applying={busy}
          onClose={() => setSheetDay(null)}
          onPick={(alt) =>
            applyReplacement.mutate({ planId, day: sheetDay, recipeId: alt.recipeId })
          }
        />
      )}
    </ScreenShell>
  );
}

function PlanHero({ plan: p }: { plan: PlanDetail }) {
  const estimated = p.unpricedLineCount > 0;
  const total = p.totalEstUah;
  return (
    <div className="plan-summary-card">
      <div className="plan-summary-price-row">
        <span className="plan-hero-price">
          Тиждень на {estimated ? approx(uah(total)) : uah(total)}
        </span>
        <span className="plan-budget-limit">з {uah(p.budgetUah)}</span>
      </div>

      <div className="plan-pills-row">
        {p.promoSharePct != null && (
          <span className="pill-amber-promo">
            Акційні позиції: {pct(p.promoSharePct)}
            {p.savingsUah != null && p.savingsUah > 0 ? ` · зекономлено ${uah(p.savingsUah)}` : ""}
          </span>
        )}
        {p.goal === "form" && (
          <span className="pill-teal-protein">
            Білок за вечерю {p.proteinFloorMet ? "✓" : "✗"} · калорійний коридор{" "}
            {p.kcalCorridorMet ? "✓" : "✗"}
          </span>
        )}
      </div>

      {estimated && (
        <p className="screen-sub-title">
          Частину позицій ({p.unpricedLineCount}) оцінено за середньою ціною категорії.
        </p>
      )}
    </div>
  );
}
