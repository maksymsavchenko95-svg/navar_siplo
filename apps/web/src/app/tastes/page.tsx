"use client";

import type { HouseholdPortrait, TasteCard } from "@navar/domain";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { pluralPeople } from "@/lib/format";
import { RESTRICTION_PICKER } from "@/lib/enums";
import {
  ArrowRight,
  PrimaryButton,
  ScreenShell,
  ScreenTitle,
  SpinnerDots,
  StateBanner,
} from "@/components/ui";

export default function TastesPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const status = trpc.household.bootstrapStatus.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });
  const bootstrap = trpc.household.bootstrap.useMutation({
    onSettled: () => void status.refetch(),
  });
  const tastes = trpc.household.inferredTastes.useQuery(undefined, {
    enabled: status.data?.status === "done",
  });
  const household = trpc.household.get.useQuery();
  const confirm = trpc.household.confirmTastes.useMutation({
    onSuccess: () => void utils.household.inferredTastes.invalidate(),
  });

  const s = status.data?.status;
  const cookingFor =
    household.data?.status === "ok"
      ? household.data.members.filter((m) => m.kind !== "pet").length || 1
      : null;

  return (
    <ScreenShell step={3} back="/numbers">
      <ScreenTitle
        title="Здається, ми вас уже трохи знаємо"
        sub="Зібрали з ваших чеків. Виправте, якщо помилились."
      />

      {(status.isLoading || !s) && <SpinnerDots />}

      {(s === "idle" || s === "error") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {s === "error" && status.data && "error" in status.data && status.data.error && (
            <StateBanner>Помилка зчитування: {status.data.error}</StateBanner>
          )}
          <p className="screen-sub-title">
            Прочитаємо ваш профіль, родину, обмеження та історію чеків у «Сільпо».
          </p>
          <PrimaryButton onClick={() => bootstrap.mutate()} disabled={bootstrap.isPending}>
            {bootstrap.isPending ? <SpinnerDots /> : "Скласти портрет"}
          </PrimaryButton>
        </div>
      )}

      {s === "running" && (
        <div className="progress-card">
          <div className="progress-step is-active">
            <SpinnerDots /> Читаю «Сільпо»: профіль → родина → обмеження → чеки
          </div>
          <p className="screen-sub-title">Це займає кілька секунд.</p>
        </div>
      )}

      {(s === "running" || s === "done") && (
        <button
          type="button"
          onClick={() => router.push("/tastes/trace")}
          style={{
            border: "none",
            background: "none",
            alignSelf: "flex-start",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--color-silpo-orange-dark)",
            textDecoration: "underline",
            cursor: "pointer",
            padding: 0,
          }}
        >
          Як це працювало
        </button>
      )}

      {s === "onboarding_required" && <OnboardingForm onDone={() => void status.refetch()} />}

      {s === "done" && tastes.isLoading && <SpinnerDots />}

      {s === "done" && tastes.data?.status === "ok" && (
        <>
          <Portrait
            portrait={tastes.data.portrait}
            busy={confirm.isPending}
            onEdit={(edit) => confirm.mutate({ edits: [edit] })}
          />
          {cookingFor != null && (
            <p className="members-line">Готуємо на {pluralPeople(cookingFor)}</p>
          )}
          <div style={{ marginTop: "auto", paddingTop: 12 }}>
            <PrimaryButton onClick={() => router.push("/plan?run=1")}>
              <span>Скласти план</span>
              <ArrowRight />
            </PrimaryButton>
          </div>
        </>
      )}
    </ScreenShell>
  );
}

type Edit =
  | { action: "accept"; id: string }
  | { action: "reject"; id: string }
  | {
      action: "add";
      kind: "allergen" | "diet" | "dislike";
      code: string;
      severity: "strict" | "soft";
    };

function Portrait({
  portrait,
  onEdit,
  busy,
}: {
  portrait: HouseholdPortrait;
  onEdit: (edit: Edit) => void;
  busy: boolean;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const presentCodes = new Set(
    portrait.allergies.map((a) => `${a.kind === "diet" ? "diet" : "allergen"}:${a.code ?? ""}`),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="screen-sub-title">
        Це припущення на основі ваших чеків — виправте, якщо щось не так.
      </p>
      {portrait.summary && <p style={{ fontSize: 12, lineHeight: 1.5 }}>{portrait.summary}</p>}
      {portrait.tags.length > 0 && (
        <div className="chips-cloud">
          {portrait.tags.map((t) => (
            <span key={t} className="chip-muted chip-muted--static">
              {t}
            </span>
          ))}
        </div>
      )}

      {portrait.oftenBought.length > 0 && (
        <div className="tastes-group">
          <div className="tastes-group-title">Часто берете</div>
          <div className="chips-cloud">
            {portrait.oftenBought.map((c) => (
              <span key={c.id} className="chip-active">
                <span>{c.label}</span>
                <button
                  type="button"
                  className="chip-remove-btn"
                  title="Не пропонувати в меню"
                  disabled={busy}
                  onClick={() => onEdit({ action: "reject", id: c.id })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {portrait.rarelyBought.length > 0 && (
        <div className="tastes-group">
          <div className="tastes-group-title">Схоже, не берете</div>
          <div className="chips-cloud">
            {portrait.rarelyBought.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip-muted"
                title="Додати у меню"
                disabled={busy}
                onClick={() => onEdit({ action: "accept", id: c.id })}
              >
                <span>{c.label}</span>
                <span className="chip-add-icon">+</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="allergies-container">
        <div className="allergies-title-row">
          <div className="allergies-title">Алергії та обмеження</div>
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--color-warning-text)" }}>
            Суворе виключення
          </span>
        </div>
        <div className="chips-cloud">
          {portrait.allergies.map((c) => (
            <span key={c.id} className="chip-allergy">
              <span>{c.label}</span>
              {c.severity && <span className="chip-allergy__sev">{c.severity}</span>}
              {c.confirmed && <span aria-label="підтверджено">✓</span>}
              {removingId === c.id ? (
                <>
                  <button
                    type="button"
                    className="chip-remove-btn"
                    disabled={busy}
                    onClick={() => {
                      onEdit({ action: "reject", id: c.id });
                      setRemovingId(null);
                    }}
                    title="Підтвердити"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="chip-remove-btn"
                    onClick={() => setRemovingId(null)}
                    title="Скасувати"
                  >
                    ↩
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="chip-remove-btn"
                  title="Прибрати обмеження — страви з ним знову з'являться в меню"
                  onClick={() => setRemovingId(c.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          <button type="button" className="chip-add-new" onClick={() => setPickerOpen((v) => !v)}>
            + Додати
          </button>
        </div>
        {pickerOpen && (
          <div className="chips-cloud" style={{ marginTop: 4 }}>
            {RESTRICTION_PICKER.filter((p) => !presentCodes.has(`${p.kind}:${p.code}`)).map((p) => (
              <button
                key={`${p.kind}:${p.code}`}
                type="button"
                className="chip-muted"
                disabled={busy}
                onClick={() => {
                  onEdit({ action: "add", kind: p.kind, code: p.code, severity: "strict" });
                  setPickerOpen(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const submit = trpc.household.submitOnboarding.useMutation({ onSuccess: onDone });
  const [budget, setBudget] = useState("2500");
  const [adults, setAdults] = useState("2");
  const [restrictions, setRestrictions] = useState("");
  const [dislikes, setDislikes] = useState("");

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({
          weeklyBudgetUah: Number(budget) || null,
          adults: Math.max(1, Math.min(12, Number(adults) || 1)),
          children: [],
          restrictionPhrases: restrictions
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          dislikedPhrases: dislikes
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          cookingWeekdays: [1, 3, 5],
          maxPrepMinutes: 45,
        });
      }}
    >
      <p className="screen-sub-title">Замало чеків для портрета — кілька питань:</p>
      <div className="tactile-input-card">
        <span className="tactile-input-label">Тижневий бюджет, ₴</span>
        <input
          className="tactile-numeric-input"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </div>
      <div className="tactile-input-card">
        <span className="tactile-input-label">Дорослих</span>
        <input
          className="tactile-numeric-input"
          inputMode="numeric"
          value={adults}
          onChange={(e) => setAdults(e.target.value)}
        />
      </div>
      <div className="tactile-input-card">
        <span className="tactile-input-label">Обмеження (через кому)</span>
        <input
          className="tactile-numeric-input"
          style={{ fontSize: 13, fontWeight: 600 }}
          value={restrictions}
          placeholder="без глютену, алергія на горіхи"
          onChange={(e) => setRestrictions(e.target.value)}
        />
      </div>
      <div className="tactile-input-card">
        <span className="tactile-input-label">Не любите (через кому)</span>
        <input
          className="tactile-numeric-input"
          style={{ fontSize: 13, fontWeight: 600 }}
          value={dislikes}
          placeholder="гриби"
          onChange={(e) => setDislikes(e.target.value)}
        />
      </div>
      {submit.isError && <StateBanner>Не вдалося зберегти. Спробуйте ще раз.</StateBanner>}
      <button type="submit" className="btn-primary" disabled={submit.isPending}>
        {submit.isPending ? <SpinnerDots /> : "Зберегти"}
      </button>
    </form>
  );
}
