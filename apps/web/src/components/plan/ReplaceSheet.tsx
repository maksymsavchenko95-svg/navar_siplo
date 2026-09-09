"use client";

import type { PlanAlternative } from "@navar/domain";

import { trpc } from "@/lib/trpc";
import { signedUah, uah } from "@/lib/format";
import { BottomSheet } from "@/components/plan/BottomSheet";
import { SpinnerDots } from "@/components/ui";

/**
 * Bottom sheet for `plan.replaceItem` (a query) → pick an alternative → the parent runs
 * `plan.applyReplacement`. Whole-plan ₴ delta is shown per option (swapping one day re-prices
 * the rest).
 */
export function ReplaceSheet({
  planId,
  day,
  onClose,
  onPick,
  applying,
}: {
  planId: string;
  day: number;
  onClose: () => void;
  onPick: (alt: PlanAlternative) => void;
  applying: boolean;
}) {
  const q = trpc.plan.replaceItem.useQuery({ planId, day });

  return (
    <BottomSheet label="Заміна страви" onClose={onClose}>
      <div className="sheet-title">Замінити страву — день {day}</div>

      {q.isLoading && <SpinnerDots />}
      {q.data?.status === "ok" && q.data.alternatives.length === 0 && (
        <p className="screen-sub-title">Немає відповідних альтернатив у межах обмежень.</p>
      )}
      {q.data?.status === "ok" &&
        q.data.alternatives.map((alt) => (
          <button
            key={alt.recipeId}
            type="button"
            className="alt-card"
            disabled={applying}
            onClick={() => onPick(alt)}
          >
            <span style={{ fontWeight: 800, fontSize: 13 }}>{alt.titleUk}</span>
            <div className="dish-meta-row">
              <span className="dish-pill-meta">{uah(alt.costUah)}</span>
              <span className="dish-pill-protein">
                {Math.round(alt.macrosPerServing.protein)} г білка
              </span>
              <span className={alt.deltaUah > 0 ? "alt-card__delta--up" : "alt-card__delta--down"}>
                {signedUah(alt.deltaUah)} до плану
              </span>
            </div>
          </button>
        ))}
      {(q.data?.status === "auth_required" || q.data?.status === "no_cart") && (
        <p className="screen-sub-title">Потрібне активне підключення до «Сільпо».</p>
      )}
      {q.data?.status === "not_found" && (
        <p className="screen-sub-title">План не знайдено — можливо, його видалили.</p>
      )}
      {q.data?.status === "error" && (
        <p className="screen-sub-title">Не вдалося підібрати заміни: {q.data.message}</p>
      )}
      {q.isError && (
        <p className="screen-sub-title">Не вдалося підібрати заміни. Спробуйте ще раз.</p>
      )}

      <button type="button" className="btn-secondary" onClick={onClose}>
        Закрити
      </button>
    </BottomSheet>
  );
}
