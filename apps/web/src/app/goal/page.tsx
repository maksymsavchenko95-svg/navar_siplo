"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  PrimaryButton,
  ScreenShell,
  ScreenTitle,
  SpinnerDots,
  StateBanner,
} from "@/components/ui";

type Goal = "routine" | "form";

const GOAL_CARDS: ReadonlyArray<{
  id: Goal;
  title: string;
  subtitle: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    id: "routine",
    title: "Рутина",
    subtitle: "Меню й закупівля для родини",
    description:
      "Збалансовані вечері на весь тиждень з урахуванням смаків кожного члена сім'ї та бюджету.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 11v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        <circle cx="12" cy="15" r="1.5" />
        <path d="M8 3v2M16 3v2" />
      </svg>
    ),
  },
  {
    id: "form",
    title: "Форма",
    subtitle: "Меню під нутрієнтну ціль",
    description:
      "Точний розрахунок білка та калорійного коридору з простих продуктів без зайвих витрат.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10" />
        <path d="M7 12h10" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

export default function GoalPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const household = trpc.household.get.useQuery();
  const setGoal = trpc.household.setGoal.useMutation({
    onSettled: () => void utils.household.get.invalidate(),
  });

  const current: Goal =
    setGoal.variables?.goal ??
    (household.data?.status === "ok" ? household.data.household.goal : "routine");

  return (
    <ScreenShell step={1}>
      <ScreenTitle
        title="Що плануємо?"
        sub="Оберіть формат тижневого кошика. Алгоритм підлаштує меню під ваші завдання."
      />

      {household.isLoading ? (
        <SpinnerDots />
      ) : (
        <>
          <div className="goal-card-stack">
            {GOAL_CARDS.map((card) => {
              const selected = current === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`goal-card ${selected ? "is-selected" : ""}`}
                  onClick={() => setGoal.mutate({ goal: card.id })}
                >
                  <div className="goal-card-top">
                    <div className="goal-card-icon-box">{card.icon}</div>
                    <div className="goal-radio-circle">
                      {selected && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="goal-card-title">{card.title}</div>
                    <div className="goal-card-subtitle">{card.subtitle}</div>
                  </div>
                  <div className="goal-card-desc">{card.description}</div>
                </button>
              );
            })}
          </div>

          {setGoal.isError && (
            <StateBanner>Не вдалося зберегти вибір. Спробуйте ще раз.</StateBanner>
          )}

          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            <PrimaryButton onClick={() => router.push("/numbers")}>
              <span>Далі</span>
              <ArrowRight />
            </PrimaryButton>
          </div>
        </>
      )}
    </ScreenShell>
  );
}
