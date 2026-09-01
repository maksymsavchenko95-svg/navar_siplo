"use client";

import type { HouseholdPortrait as PortraitData, TasteCard as Card } from "@navar/domain";
import { useState } from "react";

import { trpc } from "@/lib/trpc";

/**
 * Household portrait (T1.4, AC-P0-02). Triggers `household.bootstrap`, polls
 * `household.bootstrapStatus`, then shows the inferred taste cards — each marked as an
 * assumption (`FR-HH-004`) with accept / reject controls wired to `household.confirmTastes`.
 * The `< 3 orders` path shows a short onboarding form.
 */
export function HouseholdPortrait() {
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
  const confirm = trpc.household.confirmTastes.useMutation({
    onSuccess: () => void utils.household.inferredTastes.invalidate(),
  });

  const s = status.data?.status;

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h2>Портрет домогосподарства</h2>

      {(!s || s === "idle" || s === "error") && (
        <div>
          <button onClick={() => bootstrap.mutate()} disabled={bootstrap.isPending}>
            {bootstrap.isPending ? "…" : "Скласти портрет"}
          </button>
          {s === "error" && status.data && "error" in status.data && (
            <p style={{ color: "#b00" }}>Помилка: {status.data.error}</p>
          )}
        </div>
      )}

      {s === "running" && <p style={{ opacity: 0.6 }}>Читаю Сільпо: профіль, родину, чеки…</p>}

      {s === "onboarding_required" && <OnboardingForm onDone={() => void status.refetch()} />}

      {s === "done" && tastes.data?.status === "ok" && (
        <Portrait
          portrait={tastes.data.portrait}
          onEdit={(edit) => confirm.mutate({ edits: [edit] })}
          busy={confirm.isPending}
        />
      )}
    </section>
  );
}

function Portrait({
  portrait,
  onEdit,
  busy,
}: {
  portrait: PortraitData;
  onEdit: (edit: { action: "accept" | "reject"; id: string }) => void;
  busy: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ opacity: 0.6, margin: 0 }}>
        Це припущення на основі ваших чеків — виправте, якщо щось не так.
      </p>
      {portrait.summary && <p style={{ margin: 0 }}>{portrait.summary}</p>}
      {portrait.tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {portrait.tags.map((t) => (
            <span
              key={t}
              style={{ fontSize: 12, background: "#f0f0f0", padding: "2px 8px", borderRadius: 999 }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <CardGroup
        title="Схоже, часто берете"
        cards={portrait.oftenBought}
        onEdit={onEdit}
        busy={busy}
      />
      <CardGroup
        title="Схоже, беруть зрідка"
        cards={portrait.rarelyBought}
        onEdit={onEdit}
        busy={busy}
      />
      <CardGroup
        title="Алергії та обмеження"
        cards={portrait.allergies}
        onEdit={onEdit}
        busy={busy}
      />
    </div>
  );
}

function CardGroup({
  title,
  cards,
  onEdit,
  busy,
}: {
  title: string;
  cards: Card[];
  onEdit: (edit: { action: "accept" | "reject"; id: string }) => void;
  busy: boolean;
}) {
  if (cards.length === 0) return null;
  return (
    <div>
      <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{title}</h3>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {cards.map((c) => (
          <li
            key={c.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              borderBottom: "1px solid #eee",
              padding: "6px 0",
            }}
          >
            <span style={{ flex: 1 }}>
              {c.label}
              {c.detail ? <span style={{ opacity: 0.55 }}> · {c.detail}</span> : null}
              {c.confirmed ? <span style={{ color: "#0a0" }}> ✓</span> : null}
            </span>
            <button onClick={() => onEdit({ action: "accept", id: c.id })} disabled={busy}>
              так
            </button>
            <button onClick={() => onEdit({ action: "reject", id: c.id })} disabled={busy}>
              ні
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const submit = trpc.household.submitOnboarding.useMutation({ onSuccess: onDone });
  const [budget, setBudget] = useState("2000");
  const [adults, setAdults] = useState("2");
  const [restrictions, setRestrictions] = useState("");
  const [dislikes, setDislikes] = useState("");

  return (
    <form
      style={{ display: "grid", gap: 8, maxWidth: 360 }}
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({
          weeklyBudgetUah: Number(budget) || null,
          adults: Math.max(1, Number(adults) || 1),
          children: [],
          restrictionPhrases: restrictions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          dislikedPhrases: dislikes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          cookingWeekdays: [1, 3, 5],
          maxPrepMinutes: 45,
        });
      }}
    >
      <p style={{ opacity: 0.6, margin: 0 }}>Замало чеків для портрета — кілька питань:</p>
      <label>
        Тижневий бюджет, ₴
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        Дорослих
        <input value={adults} onChange={(e) => setAdults(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        Обмеження (через кому)
        <input
          value={restrictions}
          onChange={(e) => setRestrictions(e.target.value)}
          placeholder="без глютену, алергія на горіхи"
        />
      </label>
      <label>
        Не любите (через кому)
        <input value={dislikes} onChange={(e) => setDislikes(e.target.value)} placeholder="гриби" />
      </label>
      <button type="submit" disabled={submit.isPending}>
        {submit.isPending ? "…" : "Зберегти"}
      </button>
    </form>
  );
}
