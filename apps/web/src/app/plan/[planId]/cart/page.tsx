"use client";

import type { CartMaterializeResult, CartPreviewLine, CartShortage } from "@navar/domain";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { useReconnect } from "@/lib/auth";
import { approx, deliveryWindow, pct, quantityLabel, uah } from "@/lib/format";
import { distinctValidationMessages } from "@/lib/cart-validation";
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
  // Set when the Guest asks to re-sync an already-materialized cart — drops the result-screen
  // short-circuit so the normal preview → «Додати в кошик» flow runs again (R4).
  const [resync, setResync] = useState(false);
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
  // A successful (re-)materialize always lands here; `resync` only defers the *revisit*
  // short-circuit so the Guest re-previews before re-writing.
  if (m?.status === "ok" || (!resync && p?.status === "ok" && p.alreadyMaterialized)) {
    return (
      <ScreenShell step={5} back={`/plan/${planId}`}>
        <ScreenTitle title="Кошик Сільпо" sub="Оплата й доставка — у «Сільпо»." />
        <CartResult
          planId={planId}
          materialized={m?.status === "ok" ? m : null}
          onResync={() => {
            setResync(true);
            materialize.reset();
            setConfirmed(new Set());
            setExcluded(new Set());
            preview.mutate({ planId });
          }}
        />
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
              {resync && p.alreadyMaterialized && (
                <StateBanner tone="warn">
                  Кошик уже зібрано — оновимо його після повторного перегляду.
                </StateBanner>
              )}

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
                {materialize.isPending ? (
                  <SpinnerDots />
                ) : (
                  <span>{resync ? "Оновити кошик Сільпо" : "Додати в кошик Сільпо"}</span>
                )}
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
  onResync,
}: {
  planId: string;
  materialized: MaterializedOk | null;
  onResync: () => void;
}) {
  const router = useRouter();
  const reconnect = useReconnect();
  const live = trpc.cart.liveState.useQuery({ planId });
  const bonus = trpc.cart.offerBonus.useQuery({ planId });
  const slots = trpc.cart.deliverySlots.useQuery({ planId });
  const applyBonus = trpc.cart.applyBonus.useMutation({ onSettled: () => void bonus.refetch() });
  const reduceLine = trpc.cart.reduceLine.useMutation();
  const applyReplacement = trpc.plan.applyReplacement.useMutation();
  const [bonusOn, setBonusOn] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);
  const [skuSheetSlug, setSkuSheetSlug] = useState<string | null>(null);
  const [mealSheetDay, setMealSheetDay] = useState<number | null>(null);

  const refreshAll = () => {
    void live.refetch();
    void bonus.refetch();
    void slots.refetch();
  };

  const selectedSlot = slots.data?.status === "ok" ? slots.data.selected : null;

  const state = live.data?.status === "ok" ? live.data : null;
  const cartTotal = state?.cartTotalUah ?? materialized?.cartTotalUah ?? null;
  const validations = state?.validations ?? materialized?.validations ?? [];
  const errorMessages = distinctValidationMessages(validations, "error");
  const infoMessages = distinctValidationMessages(validations, "info");
  const shortages = state?.shortages ?? [];
  const webLink = state?.checkoutWebLink ?? materialized?.checkoutWebLink ?? null;
  const mobileLink = state?.checkoutMobileLink ?? materialized?.checkoutMobileLink ?? null;
  const checkoutReady = webLink != null || mobileLink != null;
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

      {live.isLoading && <SpinnerDots />}
      {live.data?.status === "auth_required" && <ReconnectBanner onReconnect={reconnect} />}
      {live.data?.status === "no_cart" && <NoCartBanner />}
      {live.data?.status === "error" && (
        <StateBanner title="Не вдалося перечитати кошик">{live.data.message}</StateBanner>
      )}

      {errorMessages.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {errorMessages.map((msg, i) => (
            <StateBanner key={i} tone="error">
              {msg}
            </StateBanner>
          ))}
        </div>
      )}
      {infoMessages.map((msg, i) => (
        <p key={i} className="screen-sub-title">
          {msg}
        </p>
      ))}

      {shortages.length > 0 && (
        <div className="cart-items-list">
          <div className="cart-group-title">Бракує на складі</div>
          {shortages.map((s) => (
            <ShortageRow
              key={s.productId}
              s={s}
              busy={reduceLine.isPending || applyReplacement.isPending}
              onReduce={() =>
                s.slug != null &&
                reduceLine.mutate(
                  { planId, slug: s.slug, toQuantity: s.stock },
                  { onSettled: refreshAll },
                )
              }
              onSwapSku={() => s.slug != null && setSkuSheetSlug(s.slug)}
              onSwapMeal={() => s.affectedDays.length > 0 && setMealSheetDay(s.affectedDays[0]!)}
            />
          ))}
          {reduceLine.data?.status === "not_materialized" && (
            <p className="screen-sub-title">{reduceLine.data.reason}</p>
          )}
          {reduceLine.data?.status === "rejected" && (
            <p className="screen-sub-title">{reduceLine.data.reason}</p>
          )}
          {reduceLine.data?.status === "auth_required" && (
            <ReconnectBanner onReconnect={reconnect} />
          )}
          {reduceLine.data?.status === "error" && (
            <StateBanner title="Не вдалося змінити кількість">
              {reduceLine.data.message}
            </StateBanner>
          )}
        </div>
      )}

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

      {checkoutReady ? (
        <a
          className="btn-primary"
          href={(webLink ?? mobileLink)!}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none" }}
        >
          <span>Перейти до оформлення</span>
          <ArrowRight />
        </a>
      ) : state?.blockReason ? (
        <StateBanner tone="warn" title="Оформлення поки недоступне">
          {state.blockReason}
        </StateBanner>
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

      <SecondaryButton onClick={refreshAll} disabled={live.isFetching}>
        {live.isFetching ? <SpinnerDots /> : <span>Перевірити ще раз</span>}
      </SecondaryButton>
      <SecondaryButton onClick={onResync}>Оновити кошик</SecondaryButton>

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
          onDone={refreshAll}
          onReconnect={reconnect}
        />
      )}
      {skuSheetSlug && (
        <LineSkuSheet
          planId={planId}
          slug={skuSheetSlug}
          onClose={() => setSkuSheetSlug(null)}
          onDone={() => {
            setSkuSheetSlug(null);
            refreshAll();
          }}
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
                  refreshAll();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}

function ShortageRow({
  s,
  busy,
  onReduce,
  onSwapSku,
  onSwapMeal,
}: {
  s: CartShortage;
  busy: boolean;
  onReduce: () => void;
  onSwapSku: () => void;
  onSwapMeal: () => void;
}) {
  return (
    <div className="cart-item-row is-muted">
      <div className="cart-item-info">
        <span className="cart-item-name">{s.productName ?? s.nameUk ?? s.productId}</span>
        <span className="cart-item-pack">
          лишилось {s.stock}
          {s.requested != null ? ` · потрібно ${s.requested}` : ""}
        </span>
        <div className="cart-item-actions">
          {s.slug != null && s.stock >= 1 && (
            <button type="button" className="dish-card__replace" disabled={busy} onClick={onReduce}>
              Зменшити до {s.stock}
            </button>
          )}
          {s.slug != null && (
            <button
              type="button"
              className="dish-card__replace"
              disabled={busy}
              onClick={onSwapSku}
            >
              Замінити товар
            </button>
          )}
          {s.slug != null && s.affectedDays.length > 0 && (
            <button
              type="button"
              className="dish-card__replace"
              disabled={busy}
              onClick={onSwapMeal}
            >
              Замінити страву
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
