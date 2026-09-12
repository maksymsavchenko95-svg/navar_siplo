import { MOCK_CART_ITEMS, MOCK_CART_SUMMARY } from "./mock-data";

/**
 * Static illustration of the cart screen (`/plan/[planId]/cart`) — reuses the real page's
 * `cart-item-row` / `bonus-toggle-switch` CSS classes. Not wired to tRPC; rendered inside a
 * `pointer-events: none` wrapper (`HowItWorksSection`).
 */
export function MockScreen5Cart() {
  const finalPrice = MOCK_CART_SUMMARY.subtotal - MOCK_CART_SUMMARY.bonuses;

  return (
    <div className="screen-wrapper">
      <div className="app-screen-header">
        <div className="app-screen-brand">
          <span className="app-logo-badge">N</span>
          <span className="app-brand-title">NAVAR</span>
        </div>
        <span className="app-badge-pill">Крок 5 з 5</span>
      </div>

      <div className="app-content" style={{ gap: 14 }}>
        <div>
          <h1 className="screen-hero-title">Перевірте перед оформленням</h1>
          <p className="screen-sub-title">
            Зібрали продукти під рецепти за найкращими цінами мережі.
          </p>
        </div>

        <div className="cart-items-list">
          {MOCK_CART_ITEMS.map((item) => (
            <div
              key={item.id}
              className={`cart-item-row ${item.isReplacement ? "is-replacement" : ""}`}
            >
              <div className="cart-item-main">
                <div className="cart-item-info">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="cart-item-name">{item.name}</span>
                    {item.isPromo && (
                      <span
                        className="dish-pill-promo"
                        style={{ fontSize: 10, padding: "2px 6px" }}
                      >
                        Акція
                      </span>
                    )}
                  </div>
                  <span className="cart-item-pack">{item.packSize}</span>
                </div>
                <div className="cart-item-pricing">
                  <div className="cart-item-price">{item.price} ₴</div>
                  <div className="cart-item-qty">{item.quantity} шт</div>
                </div>
              </div>

              {item.isReplacement && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div className="cart-replacement-alert">
                    <span>{item.replacementNote}</span>
                  </div>
                  <span className="cart-replacement-sub">{item.replacementOriginal}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="cart-summary-block">
          <div className="cart-summary-line">
            <span>Разом</span>
            <span style={{ fontWeight: 700, color: "var(--color-text-hero)" }}>
              {MOCK_CART_SUMMARY.subtotal.toLocaleString("uk-UA")} ₴
            </span>
          </div>

          <div className="cart-bonus-row">
            <div className="cart-bonus-left">
              <div className="bonus-toggle-switch">
                <div className="bonus-toggle-handle" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-main)" }}>
                Балабонуси
              </span>
            </div>
            <span
              style={{ fontSize: 13, fontWeight: 800, color: "var(--color-silpo-orange-dark)" }}
            >
              −{MOCK_CART_SUMMARY.bonuses} ₴
            </span>
          </div>

          <div className="cart-final-pay-row">
            <span className="cart-final-label">До сплати</span>
            <span className="cart-final-amount">{finalPrice.toLocaleString("uk-UA")} ₴</span>
          </div>
        </div>

        <div className="cart-retailer-note">{MOCK_CART_SUMMARY.retailerNotice}</div>

        <div style={{ marginTop: "auto", paddingTop: 6 }}>
          <button type="button" className="btn-primary">
            <span>Перейти до оформлення</span>
          </button>
        </div>
      </div>
    </div>
  );
}
