"use client";

import type { CartMaterializeResult, CartPreviewLine, CartValidation } from "@navar/domain";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { useReconnect } from "@/lib/auth";
import { approx, deliveryWindow, pct, quantityLabel, uah } from "@/lib/format";
import { DeliverySlotSheet } from "@/components/plan/DeliverySlotSheet";
import { LineSkuSheet } from "@/components/plan/LineSkuSheet";
import { ReplaceSheet } from "@/components/plan/ReplaceSheet";
import {
  ArrowRight,
  NoCartBanner,
  PrimaryButton,
  ReconnectBanner,
  ScreenShell,
  ScreenTitle,
  SecondaryButton,
  SpinnerDots,
  StateBanner,
} from "@/components/ui";

function humanValidation(v: CartValidation): string {
  const m = v.message;
  if (m === "order.cost.min") {
    const min = typeof v.context?.orderCostMin === "number" ? v.context.orderCostMin : null;
    return min != null
      ? `Сума кошика нижча за мінімальну для замовлення — ${uah(min)}`
      : "Сума кошика нижча за мінімальну для замовлення";
  }
  if (m === "timeslot.not_found") return "Оберіть слот доставки нижче";
  if (m === "product.offer.stock.max") return "Деяких товарів немає в потрібній кількості";
  if (m === "order.payment_types.disabled")
    return "Частина способів оплати недоступна для цієї суми";
  return m;
}

export default function CartPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const router = useRouter();
  const reconnect = useReconnect();

  const preview = trpc.cart.preview.useMutation();
  const materialize = trpc.cart.materialize.useMutation();
  const applyReplacement = trpc.plan.applyReplacement.useMutation();
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [skuSheetSlug, setSkuSheetSlug] = useState<string | null>(null);
  const [mealSheetDay, setMealSheetDay] = useState<number | null>(null);
  const fired = useRef(false);

  const refetchPreview = () => preview.mutate({ planId });

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    preview.mutate({ planId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const p = preview.data;
  const m = materialize.data;

  const toggleExclude = (slug: string, on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      on ? next.delete(slug) : next.add(slug);
      return next;
    });

  // ── phase C: result ──────────────────────────────────────────────────────
  if (m?.status === "ok" || (p?.status === "ok" && p.alreadyMaterialized)) {
    return (
      <ScreenShell step={5} back={`/plan/${planId}`}>
        <ScreenTitle title="Кошик Сільпо" sub="Оплата й доставка — у «Сільпо»." />
        <CartResult planId={planId} materialized={m?.status === "ok" ? m : null} />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell step={5} back={`/plan/${planId}`}>
      <ScreenTitle
        title="Перевірте перед оформленням"
        sub="Зібрали продукти під рецепти за цінами мережі."
      />

      {preview.isPending && <SpinnerDots />}
      {p?.status === "auth_required" && <ReconnectBanner onReconnect={reconnect} />}
      {p?.status === "no_cart" && <NoCartBanner />}
      {p?.status === "not_found" && (
        <StateBanner title="План не знайдено">
          <button onClick={() => router.push("/plans")}>До списку планів</button>
        </StateBanner>
      )}
      {p?.status === "error" && <StateBanner title="Помилка">{p.message}</StateBanner>}

      {p?.status === "ok" &&
        (() => {
          const addableTotal =
            Math.round(
              p.addable
                .filter((l) => !excluded.has(l.slug))
                .reduce((s, l) => s + (l.priceUah ?? 0) * (l.quantityKg ?? l.quantity), 0) * 100,
            ) / 100;
          const rowActions = (l: CartPreviewLine) => (
            <div className="cart-item-actions">
              <button
                type="button"
                className="dish-card__replace"
                onClick={() => setSkuSheetSlug(l.slug)}
              >
                Замінити
              </button>
              {l.proteinUnavailable && l.affectedDays.length > 0 && (
                <button
                  type="button"
                  className="dish-card__replace"
                  onClick={() => setMealSheetDay(l.affectedDays[0]!)}
                >
                  Замінити страву
                </button>
              )}
            </div>
          );

          return (
            <>
              {p.blocked.length > 0 && (
                <div className="allergies-container">
                  <div className="allergies-title">Не додано — запобіжник безпеки</div>
                  {p.blocked.map((l) => (
                    <div key={l.slug} className="cart-item-row is-blocked">
                      <div className="cart-item-name">{l.productName ?? l.nameUk}</div>
                      <div className="cart-item-reason">
                        {l.blockReason ?? "склад товару невідомий або неоднозначний"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {p.needsConfirmation.length > 0 && (
                <div className="cart-items-list">
                  <div className="cart-group-title">Потрібне підтвердження</div>
                  {p.needsConfirmation.map((l) => (
                    <div key={l.slug} className="cart-item-row cart-confirm-check">
                      <input
                        type="checkbox"
                        checked={confirmed.has(l.slug)}
                        onChange={(e) =>
                          setConfirmed((prev) => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(l.slug) : next.delete(l.slug);
                            return next;
                          })
                        }
                      />
                      <div className="cart-item-info">
                        <span className="cart-item-name">{l.productName ?? l.nameUk}</span>
                        <span className="cart-item-pack">
                          {l.confidence != null ? `впевненість ${pct(l.confidence * 100)}` : ""}
                          {l.priceUah != null ? ` · ${uah(l.priceUah)} × ${quantityLabel(l)}` : ""}
                        </span>
                        {l.proteinUnavailable && (
                          <span className="cart-item-warn">
                            Свіжого {l.nameUk} немає в магазині
                          </span>
                        )}
                        {rowActions(l)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(p.outOfStock.length > 0 || p.unmatched.length > 0) && (
                <div className="cart-items-list">
                  <div className="cart-group-title">Не вдалося підібрати</div>
                  {[...p.outOfStock, ...p.unmatched].map((l) => (
                    <div key={l.slug} className="cart-item-row is-muted">
                      <div className="cart-item-info">
                        <span className="cart-item-name">{l.productName ?? l.nameUk}</span>
                        <span className="cart-item-pack">
                          {l.proteinUnavailable
                            ? `Свіжого ${l.nameUk} немає в магазині`
                            : "немає в наявності"}
                        </span>
                        {rowActions(l)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="cart-items-list">
                <div className="cart-group-title">Додаємо в кошик</div>
                {p.addable.map((l) => {
                  const on = !excluded.has(l.slug);
                  return (
                    <div
                      key={l.slug}
                      className={`cart-item-row cart-confirm-check ${on ? "" : "is-muted"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggleExclude(l.slug, e.target.checked)}
                      />
                      <div className="cart-item-info">
                        <span className="cart-item-name">{l.productName ?? l.nameUk}</span>
                        <span className="cart-item-pack">
                          {l.priceUah != null ? `${uah(l.priceUah)} × ${quantityLabel(l)}` : ""}
                          {l.isPromo ? " · Акція" : ""}
                        </span>
                        {l.proteinUnavailable && (
                          <span className="cart-item-warn">
                            Свіжого {l.nameUk} немає в магазині
                          </span>
                        )}
                        {rowActions(l)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cart-summary-block">
                <div className="cart-summary-line">
                  <span>Орієнтовно</span>
                  <strong>{approx(uah(addableTotal))}</strong>
                </div>
                {excluded.size > 0 && (
                  <p className="screen-sub-title">Вилучено позицій: {excluded.size}</p>
                )}
                {p.currentCartLines > 0 && (
                  <p className="screen-sub-title">
                    У вашому кошику «Сільпо» вже є {p.currentCartLines} позицій — ми їх не чіпаємо.
                  </p>
                )}
              </div>

              {materialize.data?.status === "needs_preview" && (
                <StateBanner tone="warn">Оновіть перегляд і спробуйте ще раз.</StateBanner>
              )}
              {materialize.data?.status === "auth_required" && (
                <ReconnectBanner onReconnect={reconnect} />
              )}
              {materialize.data?.status === "error" && (
                <StateBanner title="Не вдалося записати">{materialize.data.message}</StateBanner>
              )}

              <PrimaryButton
                onClick={() =>
                  materialize.mutate({
                    planId,
                    confirmedLines: [...confirmed],
                    excludeSlugs: [...excluded],
                  })
                }
                disabled={materialize.isPending}
              >
                {materialize.isPending ? <SpinnerDots /> : <span>Додати в кошик Сільпо</span>}
              </PrimaryButton>
            </>
          );
        })()}

      {skuSheetSlug && (
        <LineSkuSheet
          planId={planId}
          slug={skuSheetSlug}
          onClose={() => setSkuSheetSlug(null)}
          onDone={refetchPreview}
        />
      )}
      {mealSheetDay != null && (
        <ReplaceSheet
          planId={planId}
          day={mealSheetDay}
          applying={applyReplacement.isPending}
          onClose={() => setMealSheetDay(null)}
          onPick={(alt) =>
            applyReplacement.mutate(
              { planId, day: mealSheetDay, recipeId: alt.recipeId },
              {
                onSettled: () => {
                  setMealSheetDay(null);
                  refetchPreview();
                },
              },
            )
          }
        />
      )}
    </ScreenShell>
  );
}

type MaterializedOk = Extract<CartMaterializeResult, { status: "ok" }>;

function CartResult({
  planId,
  materialized,
}: {
  planId: string;
  materialized: MaterializedOk | null;
}) {
  const router = useRouter();
  const reconnect = useReconnect();
  const bonus = trpc.cart.offerBonus.useQuery({ planId });
  const checkout = trpc.cart.checkoutLink.useQuery({ planId });
  const slots = trpc.cart.deliverySlots.useQuery({ planId });
  const applyBonus = trpc.cart.applyBonus.useMutation({ onSettled: () => void bonus.refetch() });
  const [bonusOn, setBonusOn] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);

  const selectedSlot = slots.data?.status === "ok" ? slots.data.selected : null;
  const afterSlotChange = () => {
    void checkout.refetch();
    void bonus.refetch();
    void slots.refetch();
  };

  const cartTotal = materialized?.cartTotalUah ?? null;
  const validations = materialized?.validations ?? [];
  const bonusOffer =
    bonus.data?.status === "ok" && bonus.data.isEnabled && bonus.data.available > 0
      ? bonus.data
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {materialized && (
        <div className="cart-summary-block">
          <div className="cart-summary-line">
            <span>Додано позицій</span>
            <strong>{materialized.addedCount}</strong>
          </div>
          {materialized.skipped.length > 0 && (
            <div className="cart-summary-line" style={{ alignItems: "flex-start" }}>
              <span>Пропущено</span>
              <span style={{ textAlign: "right", maxWidth: "60%" }}>
                {materialized.skipped.map((s) => s.nameUk).join(", ")}
              </span>
            </div>
          )}
        </div>
      )}

      {validations.filter((v) => v.level === "error").length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {validations
            .filter((v) => v.level === "error")
            .map((v, i) => (
              <StateBanner key={i} tone="error">
                {humanValidation(v)}
              </StateBanner>
            ))}
        </div>
      )}
      {validations
        .filter((v) => v.level === "info")
        .map((v, i) => (
          <p key={i} className="screen-sub-title">
            {humanValidation(v)}
          </p>
        ))}

      {materialized && cartTotal != null && (
        <div className="cart-summary-block">
          <div className="cart-summary-line">
            <span>Разом (кошик Сільпо)</span>
            <strong>{uah(cartTotal)}</strong>
          </div>
          {materialized.planEstimateUah != null && (
            <div className="cart-summary-line">
              <span>За планом</span>
              <span>{uah(materialized.planEstimateUah)}</span>
            </div>
          )}
          {materialized.totalsWithinTolerance != null && (
            <span
              className={`tolerance-badge ${materialized.totalsWithinTolerance ? "is-ok" : "is-off"}`}
            >
              {materialized.totalsWithinTolerance
                ? "розбіжність ≤ 3 % ✓"
                : "розбіжність > 3 % — перевірте пропущені позиції"}
            </span>
          )}
        </div>
      )}

      {bonusOffer && (
        <div className="cart-summary-block">
          <div className="cart-bonus-row">
            <div className="cart-bonus-left">
              <button
                type="button"
                className={`bonus-toggle-switch ${bonusOn ? "" : "is-off"}`}
                aria-pressed={bonusOn}
                onClick={() => {
                  const next = !bonusOn;
                  setBonusOn(next);
                  applyBonus.mutate({ planId, amount: next ? bonusOffer.available : null });
                }}
              >
                <span className="bonus-toggle-handle" />
              </button>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                Списати {bonusOffer.available} балабонусів
              </span>
            </div>
          </div>
          {applyBonus.data?.status === "ok" &&
            applyBonus.data.cartTotalAfterDiscountsUah != null && (
              <div className="cart-final-pay-row">
                <span className="cart-final-label">До сплати</span>
                <span className="cart-final-amount">
                  {uah(applyBonus.data.cartTotalAfterDiscountsUah)}
                </span>
              </div>
            )}
        </div>
      )}

      {checkout.data?.status === "ok" && (checkout.data.webLink || checkout.data.mobileLink) ? (
        <a
          className="btn-primary"
          href={(checkout.data.webLink ?? checkout.data.mobileLink)!}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none" }}
        >
          <span>Перейти до оформлення</span>
          <ArrowRight />
        </a>
      ) : checkout.data?.status === "unavailable" ? (
        <StateBanner tone="warn" title="Оформлення поки недоступне">
          {checkout.data.reason}
        </StateBanner>
      ) : checkout.isLoading ? (
        <SpinnerDots />
      ) : null}

      <div className="cart-slot-row">
        <span className="screen-sub-title">
          {selectedSlot
            ? `Слот доставки: ${deliveryWindow(selectedSlot.start, selectedSlot.end)}`
            : "Слот доставки не обрано"}
        </span>
        <button type="button" className="dish-card__replace" onClick={() => setSlotOpen(true)}>
          {selectedSlot ? "Змінити слот" : "Обрати слот доставки"}
        </button>
      </div>

      <p className="cart-retailer-note">Оплата й доставка — у «Сільпо».</p>
      <SecondaryButton onClick={() => (window.location.href = `/plan/${planId}/trace`)}>
        Як це працювало
      </SecondaryButton>
      <SecondaryButton onClick={() => router.push("/plans")}>До планів</SecondaryButton>

      {slotOpen && (
        <DeliverySlotSheet
          planId={planId}
          selected={selectedSlot}
          onClose={() => setSlotOpen(false)}
          onDone={afterSlotChange}
          onReconnect={reconnect}
        />
      )}
    </div>
  );
}
