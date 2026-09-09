"use client";

import type { DeliverySlot } from "@navar/domain";
import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { deliveryWindow, uah } from "@/lib/format";
import { BottomSheet } from "@/components/plan/BottomSheet";
import { ReconnectBanner, SpinnerDots, StateBanner } from "@/components/ui";

/**
 * Bottom sheet for `cart.deliverySlots` → pick a window → `cart.setDeliverySlot` writes it
 * to the Silpo cart and re-reads. `onDone` fires after a successful write so the parent can
 * refresh the checkout link / bonus offer.
 */
export function DeliverySlotSheet({
  planId,
  selected,
  onClose,
  onDone,
  onReconnect,
}: {
  planId: string;
  selected: { start: string; end: string } | null;
  onClose: () => void;
  onDone: () => void;
  onReconnect: () => void;
}) {
  const q = trpc.cart.deliverySlots.useQuery({ planId });
  const set = trpc.cart.setDeliverySlot.useMutation();
  const [pending, setPending] = useState<string | null>(null);

  const isSelected = (s: DeliverySlot) =>
    selected != null && selected.start === s.start && selected.end === s.end;

  const pick = (s: DeliverySlot) => {
    setPending(s.start + s.end);
    set.mutate(
      { planId, slot: { start: s.start, end: s.end } },
      {
        onSettled: () => setPending(null),
        onSuccess: (r) => {
          if (r.status === "ok") {
            onDone();
            onClose();
          }
        },
      },
    );
  };

  const r = set.data;

  return (
    <BottomSheet label="Слот доставки" onClose={onClose}>
      <div className="sheet-title">Оберіть слот доставки</div>

      {q.isLoading && <SpinnerDots />}
      {(q.data?.status === "auth_required" || r?.status === "auth_required") && (
        <ReconnectBanner onReconnect={onReconnect} />
      )}
      {q.data?.status === "no_cart" && (
        <p className="screen-sub-title">
          У вашому акаунті «Сільпо» ще немає кошика — створіть його в застосунку «Сільпо».
        </p>
      )}
      {q.data?.status === "not_found" && (
        <p className="screen-sub-title">План не знайдено — можливо, його видалили.</p>
      )}
      {q.data?.status === "error" && (
        <p className="screen-sub-title">Не вдалося завантажити слоти: {q.data.message}</p>
      )}
      {q.data?.status === "ok" && q.data.slots.length === 0 && (
        <p className="screen-sub-title">
          Для цього магазину зараз немає доступних слотів. Спробуйте пізніше або оберіть слот у
          застосунку «Сільпо».
        </p>
      )}

      {q.data?.status === "ok" &&
        q.data.slots.map((s) => (
          <button
            key={s.start + s.end}
            type="button"
            className={`alt-card ${isSelected(s) ? "is-current" : ""}`}
            disabled={!s.available || set.isPending}
            onClick={() => pick(s)}
          >
            <span style={{ fontWeight: 800, fontSize: 13 }}>
              {deliveryWindow(s.start, s.end)}
              {isSelected(s) ? " · обрано" : ""}
            </span>
            <div className="dish-meta-row">
              {!s.available && <span className="dish-pill-meta">немає місць</span>}
              {s.minOrderCostUah != null && s.minOrderCostUah > 0 && (
                <span className="dish-pill-meta">від {uah(s.minOrderCostUah)}</span>
              )}
              {pending === s.start + s.end && <SpinnerDots />}
            </div>
          </button>
        ))}

      {r?.status === "rejected" && <StateBanner tone="warn">{r.reason}</StateBanner>}
      {r?.status === "no_cart" && (
        <p className="screen-sub-title">У вашому акаунті «Сільпо» немає кошика.</p>
      )}
      {r?.status === "error" && <StateBanner title="Слот не збережено">{r.message}</StateBanner>}
      {set.isError && <StateBanner title="Слот не збережено">Спробуйте ще раз.</StateBanner>}

      <button type="button" className="btn-secondary" onClick={onClose}>
        Закрити
      </button>
    </BottomSheet>
  );
}
