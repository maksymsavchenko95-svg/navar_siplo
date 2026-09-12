"use client";

import type { NearestPlan } from "@navar/domain";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { useReconnect } from "@/lib/auth";
import { approx, groupNumber, pct, pluralPeople, uah } from "@/lib/format";
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

const PHASES = ["Читаю акції та персональні пропозиції", "Підбираю товари", "Рахую меню"];

/** T4.5 — the real pipeline stage from `plan.generationStage` → which PHASE is active. */
const STAGE_TO_PHASE: Record<string, number> = {
  context: 0,
  pricing: 1,
  solving: 2,
  saving: 2,
  explaining: 2,
  done: 2,
};

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <ScreenShell step={4} back="/tastes">
          <SpinnerDots />
        </ScreenShell>
      }
    >
      <GenerateInner />
    </Suspense>
  );
}

function GenerateInner() {
  const router = useRouter();
  const reconnect = useReconnect();
  const household = trpc.household.get.useQuery();
  const generate = trpc.plan.generate.useMutation();
  // T4.5 — poll the real pipeline stage while the (still synchronous) mutation is in flight.
  const genStage = trpc.plan.generationStage.useQuery(undefined, {
    enabled: generate.isPending,
    refetchInterval: generate.isPending ? 1200 : false,
  });

  const searchParams = useSearchParams();
  // `/tastes` sends the Guest here with `?run=1` to generate immediately. A bare `/plan`
  // (brand mark, «Новий план», or a back-navigation) must NOT auto-generate — otherwise
  // every "Back" from a plan silently runs the solver and persists a duplicate (R1).
  const runParam = searchParams.get("run") === "1";
  // Guests never pick a seed (backend picks one at random — `plan.ts`'s `randomSeed()`); a
  // `?seed=` override exists only for us to force a repeatable plan while rehearsing/recording
  // the AC-P0-09 determinism demo. Omitted (the normal case) → undefined → backend randomizes.
  const seedParam = searchParams.get("seed");
  const seedOverride = seedParam != null && seedParam !== "" ? Number(seedParam) : undefined;

  const [elapsed, setElapsed] = useState(0);
  const fired = useRef(false);

  const budgetUah =
    household.data?.status === "ok" ? (household.data.household.weeklyBudgetUah ?? 2500) : 2500;
  const goal = household.data?.status === "ok" ? household.data.household.goal : "routine";
  const nutritionTargets =
    household.data?.status === "ok" ? household.data.household.nutritionTargets : null;
  // form goal always plans for one person (`plan.ts` forces `servings = 1`); routine scales
  // by the real household size.
  const servingsCount =
    household.data?.status === "ok"
      ? household.data.members.filter((m) => m.kind !== "pet").length || 1
      : 1;

  const run = () => {
    setElapsed(0);
    generate.mutate({ goal, budgetUah, days: 5, seed: seedOverride });
  };

  useEffect(() => {
    if (!runParam || fired.current || household.data?.status !== "ok") return;
    fired.current = true;
    // Drop `?run=1` so a reload / back-nav here does not re-fire (R1), but keep `?seed=`
    // so a demo override survives the auto-generate's own redirect for a later retry.
    router.replace(seedParam != null ? `/plan?seed=${seedParam}` : "/plan");
    generate.mutate({ goal, budgetUah, days: 5, seed: seedOverride });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runParam, household.data?.status]);

  useEffect(() => {
    if (!generate.isPending) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [generate.isPending]);

  const res = generate.data;
  const idle = !generate.isPending && !res && !runParam;

  useEffect(() => {
    if (res?.status === "ok") router.replace(`/plan/${res.planId}`);
  }, [res, router]);

  return (
    <ScreenShell step={4} back="/tastes">
      <ScreenTitle
        title={idle ? "Скласти план" : "Складаю план"}
        sub="Новий 5-денний план на основі вашої цілі та бюджету, без порушення обмежень."
      />

      {idle && (
        <>
          <div className="plan-summary-card">
            <div className="plan-summary-price-row">
              <span className="plan-hero-price">
                {goal === "form" ? "Підтримання форми" : "Автоматизація рутини"}
              </span>
              <span className="plan-budget-limit">{uah(budgetUah)} / тиждень</span>
            </div>
            <div className="plan-pills-row">
              {goal === "form" ? (
                nutritionTargets && (
                  <>
                    <span className="pill-teal-protein">
                      {groupNumber(nutritionTargets.kcalTarget)} ккал/добу
                    </span>
                    <span className="pill-teal-protein">
                      мінімум {nutritionTargets.proteinMinG} г білка
                    </span>
                  </>
                )
              ) : (
                <span className="pill-teal-protein">Кошик на {pluralPeople(servingsCount)}</span>
              )}
            </div>
          </div>
          <PrimaryButton onClick={run}>
            <span>Скласти план</span>
          </PrimaryButton>
          <SecondaryButton onClick={() => router.push("/goal")}>
            Змінити ціль і бюджет
          </SecondaryButton>
        </>
      )}
      {runParam && !generate.isPending && !res && <SpinnerDots />}

      {generate.isPending && (
        <div className="progress-card">
          {PHASES.map((p, i) => {
            // Real stage from the backend once the first poll lands; the time heuristic
            // only bridges the ~1 s before that.
            const stage = genStage.data?.stage;
            const stepAt =
              stage != null
                ? (STAGE_TO_PHASE[stage] ?? PHASES.length - 1)
                : Math.min(PHASES.length - 1, Math.floor(elapsed / 6));
            return (
              <div
                key={p}
                className={`progress-step ${i === stepAt ? "is-active" : i < stepAt ? "is-done" : ""}`}
              >
                {i === stepAt ? <SpinnerDots /> : i < stepAt ? "✓" : "•"} {p}
              </div>
            );
          })}
          <p className="screen-sub-title">≈ {elapsed} с — перше складання займає до 20 с.</p>
        </div>
      )}

      {res?.status === "ok" && <SpinnerDots />}

      {res?.status === "infeasible" && (
        <InfeasibleResult
          reason={res.reason}
          shortfallUah={res.shortfallUah}
          budgetUah={budgetUah}
          nearest={res.nearest}
          onAccept={
            res.shortfallUah != null
              ? () =>
                  generate.mutate({
                    goal,
                    budgetUah: Math.ceil(budgetUah + (res.shortfallUah ?? 0)),
                    days: 5,
                    seed: seedOverride,
                  })
              : undefined
          }
          onEditBudget={() => router.push("/numbers")}
        />
      )}

      {res?.status === "auth_required" && <ReconnectBanner onReconnect={reconnect} />}
      {res?.status === "no_cart" && <NoCartBanner />}
      {res?.status === "error" && (
        <>
          <StateBanner title="Не вдалося скласти план">{res.message}</StateBanner>
          <SecondaryButton onClick={run}>Спробувати ще раз</SecondaryButton>
        </>
      )}
    </ScreenShell>
  );
}

function InfeasibleResult({
  reason,
  shortfallUah,
  budgetUah,
  nearest,
  onAccept,
  onEditBudget,
}: {
  reason: string;
  shortfallUah?: number;
  budgetUah: number;
  nearest?: NearestPlan;
  onAccept?: () => void;
  onEditBudget: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="conflict-notice-box">
        <span>{reason}</span>
      </div>

      {nearest && (
        <div className="plan-summary-card">
          <div className="plan-summary-price-row">
            <span className="plan-hero-price">Найближчий варіант: {uah(nearest.costUah)}</span>
            <span className="plan-budget-limit">
              бюджет {uah(budgetUah)}
              {shortfallUah != null ? ` (+${uah(shortfallUah)})` : ""}
            </span>
          </div>
          <div className="plan-pills-row">
            <span className="pill-amber-promo">Акційні позиції: {pct(nearest.promoSharePct)}</span>
          </div>
          <div className="dishes-list">
            {nearest.days.map((d) => (
              <div key={d.day} className="dish-card is-locked">
                <div className="dish-card-header">
                  <span className="dish-card-title">{d.titleUk}</span>
                  <span className="dish-day-tag">День {d.day}</span>
                </div>
                <div className="dish-meta-row">
                  <span className="dish-pill-meta">{uah(d.costUah)}</span>
                  <span className="dish-pill-protein">
                    {Math.round(d.macrosPerServing.protein)} г білка
                  </span>
                  {d.promoShareUah > 0 && <span className="dish-pill-promo">Акція</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {onAccept && shortfallUah != null && (
        <PrimaryButton onClick={onAccept}>Прийняти +{uah(shortfallUah)}</PrimaryButton>
      )}
      <SecondaryButton onClick={onEditBudget}>Змінити бюджет</SecondaryButton>
      <p className="screen-sub-title">{approx(uah(budgetUah))} — поточний бюджет.</p>
    </div>
  );
}
