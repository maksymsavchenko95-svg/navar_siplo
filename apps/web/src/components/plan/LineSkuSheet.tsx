"use client";

import { trpc } from "@/lib/trpc";
import { uah } from "@/lib/format";
import { BottomSheet } from "@/components/plan/BottomSheet";
import { SpinnerDots } from "@/components/ui";

/**
 * Bottom sheet for `cart.lineAlternatives` (a query) → pick a different SKU for one
 * shopping-list line → `cart.setLineSku` (a mutation) → the parent re-fires `cart.preview`.
 * Mirrors `ReplaceSheet`, but swaps a product rather than a dish.
 */
export function LineSkuSheet({
  planId,
  slug,
  onClose,
  onDone,
}: {
  planId: string;
  slug: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const q = trpc.cart.lineAlternatives.useQuery({ planId, slug });
  const set = trpc.cart.setLineSku.useMutation({
    onSuccess: (r) => {
      if (r.status === "ok") {
        onDone();
        onClose();
      }
    },
  });

  const title = q.data?.status === "ok" ? q.data.nameUk : "Заміна товару";
  const err =
    set.data?.status === "rejected"
      ? set.data.reason
      : set.data?.status === "already_materialized"
        ? set.data.reason
        : set.data?.status === "error"
          ? set.data.message
          : null;

  return (
    <BottomSheet label="Заміна товару" onClose={onClose}>
      <div className="sheet-title">Інший товар — {title}</div>

      {q.isLoading && <SpinnerDots />}
      {q.data?.status === "ok" && q.data.alternatives.length === 0 && (
        <p className="screen-sub-title">Інших варіантів у цьому магазині немає.</p>
      )}
      {q.data?.status === "ok" &&
        q.data.alternatives.map((a) => (
          <button
            key={a.productId}
            type="button"
            className={`alt-card ${a.isCurrent ? "alt-card--current" : ""}`}
            disabled={set.isPending || a.isCurrent}
            onClick={() => set.mutate({ planId, slug, productId: a.productId })}
          >
            <span style={{ fontWeight: 800, fontSize: 13 }}>
              {a.name}
              {a.isCurrent ? " · зараз" : ""}
            </span>
            <div className="dish-meta-row">
              {a.packSizeLabel && <span className="dish-pill-meta">{a.packSizeLabel}</span>}
              <span className="dish-pill-meta">
                {uah(a.lineTotalUah)} ({a.packCount} уп.)
              </span>
              {a.isPromo && <span className="dish-pill-promo">Акція</span>}
              {!a.inStock && <span className="dish-pill-meta">немає</span>}
            </div>
          </button>
        ))}
      {(q.data?.status === "auth_required" || q.data?.status === "no_cart") && (
        <p className="screen-sub-title">Потрібне активне підключення до «Сільпо».</p>
      )}
      {q.data?.status === "error" && (
        <p className="screen-sub-title">Не вдалося завантажити варіанти: {q.data.message}</p>
      )}
      {err && <p className="screen-sub-title">{err}</p>}

      <button type="button" className="btn-secondary" onClick={onClose}>
        Закрити
      </button>
    </BottomSheet>
  );
}
