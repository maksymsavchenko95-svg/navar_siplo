"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { uah, pct, groupNumber, pluralPeople } from "@/lib/format";
import {
  ACTIVITY_OPTIONS,
  DIRECTION_OPTIONS,
  SEX_OPTIONS,
  type Activity,
  type Direction,
  type Sex,
} from "@/lib/enums";
import {
  ArrowRight,
  PrimaryButton,
  ScreenShell,
  ScreenTitle,
  Segmented,
  SpinnerDots,
  Stepper,
} from "@/components/ui";

const BUDGET_STEP = 50;
const DEFAULT_BUDGET = 2500;
const BUDGET_MIN = 400;
const BUDGET_MAX = 20000;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function NumbersPage() {
  const router = useRouter();
  const household = trpc.household.get.useQuery();
  const goal = household.data?.status === "ok" ? household.data.household.goal : "routine";

  return (
    <ScreenShell step={2} back="/goal">
      <ScreenTitle
        title="Кілька цифр"
        sub="Використовуємо для розрахунку ситного коридору та вартості кошика."
      />
      {household.isLoading ? (
        <SpinnerDots />
      ) : (
        <div className="form-grid">
          <BudgetField
            initial={
              (household.data?.status === "ok" && household.data.household.weeklyBudgetUah) ||
              DEFAULT_BUDGET
            }
          />
          {goal !== "form" && (
            <MembersField
              initialAdults={
                household.data?.status === "ok"
                  ? household.data.members.filter((m) => m.kind === "adult").length || 1
                  : 1
              }
              initialChildren={
                household.data?.status === "ok"
                  ? household.data.members.filter((m) => m.kind === "child").length
                  : 0
              }
            />
          )}
          {goal === "form" && <NutritionForm />}
          <div style={{ marginTop: 8, paddingTop: 8 }}>
            <PrimaryButton onClick={() => router.push("/tastes")}>
              <span>Далі</span>
              <ArrowRight />
            </PrimaryButton>
          </div>
        </div>
      )}
    </ScreenShell>
  );
}

function BudgetField({ initial }: { initial: number }) {
  const utils = trpc.useUtils();
  const setBudget = trpc.household.setBudget.useMutation({
    onSettled: () => void utils.household.get.invalidate(),
  });
  const [budget, setBudget_] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initial));

  const debounced = useDebounced(budget, 500);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setBudget.mutate({ weeklyBudgetUah: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const commitDraft = () => {
    const parsed = parseInt(draft.replace(/\D/g, ""), 10);
    if (!Number.isNaN(parsed) && parsed >= BUDGET_MIN && parsed <= BUDGET_MAX) setBudget_(parsed);
    else setDraft(String(budget));
    setEditing(false);
  };

  const clamped = Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, budget));
  const fillPct = ((clamped - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100;

  return (
    <div className="form-card-field">
      <div className="field-label-row">
        <span className="field-label">Бюджет на тиждень</span>
        {editing ? (
          <div className="budget-inline-editor">
            <input
              type="number"
              className="budget-number-input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => e.key === "Enter" && commitDraft()}
            />
            <button type="button" className="budget-confirm-btn" onClick={commitDraft}>
              OK
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="budget-value-trigger"
            title="Натисніть, щоб ввести точну суму"
            onClick={() => {
              setDraft(String(budget));
              setEditing(true);
            }}
          >
            <span className="field-value-bold">{uah(budget)}</span>
          </button>
        )}
      </div>

      <div className="budget-slider-container">
        <input
          type="range"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={BUDGET_STEP}
          value={clamped}
          className="custom-range-slider"
          onChange={(e) => {
            const v = Number(e.target.value);
            setBudget_(v);
            setDraft(String(v));
          }}
          style={{
            background: `linear-gradient(to right, var(--color-silpo-orange) 0%, var(--color-silpo-orange) ${fillPct}%, #e5e0d8 ${fillPct}%, #e5e0d8 100%)`,
          }}
        />
        <div className="slider-bounds">
          <span>{uah(BUDGET_MIN)}</span>
          <span>{uah(BUDGET_MAX)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * R5 — editable household size, `routine` goal only. Bootstrap seeds `household_members` from
 * Silpo's family list, which is often just the account holder; `servings` (which scales every
 * recipe's cost and the budget check) is derived from it at `plan.generate`. `form` goal always
 * plans for one person (forced server-side in `plan.ts`), so this picker is hidden there.
 * Mirrors `BudgetField`'s debounced-write shape.
 */
function MembersField({
  initialAdults,
  initialChildren,
}: {
  initialAdults: number;
  initialChildren: number;
}) {
  const utils = trpc.useUtils();
  const setMembers = trpc.household.setMembers.useMutation({
    onSettled: () => void utils.household.get.invalidate(),
  });
  const [adults, setAdults] = useState(initialAdults);
  const [children, setChildren] = useState(initialChildren);

  const dAdults = useDebounced(adults, 400);
  const dChildren = useDebounced(children, 400);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setMembers.mutate({ adults: dAdults, children: dChildren });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dAdults, dChildren]);

  return (
    <div className="form-card-field">
      <div className="field-label-row">
        <span className="field-label">Скільки осіб</span>
        <span className="field-value-bold">{pluralPeople(adults + children)}</span>
      </div>
      <div className="form-2col-row">
        <div className="tactile-input-card">
          <span className="tactile-input-label">Дорослі</span>
          <Stepper
            value={adults}
            min={1}
            max={12}
            onChange={setAdults}
            ariaLabel="Кількість дорослих"
          />
        </div>
        <div className="tactile-input-card">
          <span className="tactile-input-label">Діти</span>
          <Stepper
            value={children}
            min={0}
            max={12}
            onChange={setChildren}
            ariaLabel="Кількість дітей"
          />
        </div>
      </div>
    </div>
  );
}

function NutritionForm() {
  const compute = trpc.household.computeNutrition.useMutation();
  const [sex, setSex] = useState<Sex>("male");
  const [age, setAge] = useState(34);
  const [weight, setWeight] = useState(78);
  const [height, setHeight] = useState(181);
  const [activity, setActivity] = useState<Activity>("moderate");
  const [direction, setDirection] = useState<Direction>("maintain");

  const input = useMemo(
    () => ({
      sex,
      ageYears: age,
      weightKg: weight,
      heightCm: height,
      activity,
      direction,
    }),
    [sex, age, weight, height, activity, direction],
  );
  const debounced = useDebounced(input, 300);
  useEffect(() => {
    if (debounced.ageYears >= 16 && debounced.weightKg >= 35 && debounced.heightCm >= 100) {
      compute.mutate(debounced);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const result = compute.data;

  return (
    <>
      <div className="form-2col-row">
        <div className="form-card-field">
          <span className="field-label">Стать</span>
          <Segmented value={sex} options={SEX_OPTIONS} onChange={setSex} ariaLabel="Стать" />
        </div>
        <div className="tactile-input-card">
          <label htmlFor="age" className="tactile-input-label">
            Вік
          </label>
          <div className="tactile-input-wrapper">
            <input
              id="age"
              type="number"
              min={16}
              max={99}
              className="tactile-numeric-input"
              value={age}
              onChange={(e) => setAge(Number(e.target.value) || 0)}
            />
            <span className="tactile-input-unit">р.</span>
          </div>
        </div>
      </div>

      <div className="form-2col-row">
        <div className="tactile-input-card">
          <label htmlFor="weight" className="tactile-input-label">
            Вага
          </label>
          <div className="tactile-input-wrapper">
            <input
              id="weight"
              type="number"
              min={35}
              max={220}
              className="tactile-numeric-input"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value) || 0)}
            />
            <span className="tactile-input-unit">кг</span>
          </div>
        </div>
        <div className="tactile-input-card">
          <label htmlFor="height" className="tactile-input-label">
            Зріст
          </label>
          <div className="tactile-input-wrapper">
            <input
              id="height"
              type="number"
              min={100}
              max={230}
              className="tactile-numeric-input"
              value={height}
              onChange={(e) => setHeight(Number(e.target.value) || 0)}
            />
            <span className="tactile-input-unit">см</span>
          </div>
        </div>
      </div>

      <div className="form-card-field">
        <span className="field-label">Активність</span>
        <Segmented
          value={activity}
          options={ACTIVITY_OPTIONS}
          onChange={setActivity}
          ariaLabel="Рівень активності"
        />
      </div>

      <div className="form-card-field">
        <span className="field-label">Напрям</span>
        <Segmented
          value={direction}
          options={DIRECTION_OPTIONS}
          onChange={setDirection}
          ariaLabel="Напрям"
        />
      </div>

      {result?.status === "rejected" ? (
        <div className="frosted-glass-dark is-warning">
          <div className="hero-computed-header">
            <div className="hero-computed-title-wrap">
              <span className="hero-computed-title">Ціль не підходить</span>
            </div>
          </div>
          <div className="hero-computed-footer-note" style={{ color: "rgba(255,255,255,0.92)" }}>
            {result.reason} Мінімум — {result.floorKcal} ккал/добу, а за вашими даними виходить{" "}
            {result.computedKcal} ккал. Змініть напрям або параметри.
          </div>
        </div>
      ) : (
        <div className="frosted-glass-dark">
          <div className="hero-computed-header">
            <div className="hero-computed-title-wrap">
              <span className="hero-computed-dot" />
              <span className="hero-computed-title">Ваша ціль</span>
            </div>
          </div>
          <div className="hero-metrics-grid">
            <div className="hero-metric-tile">
              <div className="hero-metric-tile-header">
                <span className="hero-metric-label">Білок</span>
                <span className="hero-metric-badge-mini">мінімум</span>
              </div>
              <div className="hero-metric-value-display">
                <span className="hero-metric-num">
                  {result?.status === "ok" ? result.targets.proteinMinG : "—"}
                </span>
                <span className="hero-metric-unit">г / добу</span>
              </div>
            </div>
            <div className="hero-metric-tile">
              <div className="hero-metric-tile-header">
                <span className="hero-metric-label">Калорії</span>
                <span className="hero-metric-badge-mini">
                  {result?.status === "ok"
                    ? `±${pct(result.targets.kcalTolerance * 100)}`
                    : "коридор"}
                </span>
              </div>
              <div className="hero-metric-value-display">
                <span className="hero-metric-num">
                  {result?.status === "ok" ? groupNumber(result.targets.kcalTarget) : "—"}
                </span>
                <span className="hero-metric-unit">ккал</span>
              </div>
            </div>
          </div>
          <div className="hero-computed-footer-note">
            Розраховано автоматично з ваших даних — вводити цифри вручну не потрібно.
          </div>
        </div>
      )}
    </>
  );
}
