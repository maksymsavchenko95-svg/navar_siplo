import { MOCK_PLAN_DATA } from "./mock-data";

/**
 * Static illustration of the plan hero (`/plan/[planId]`) — reuses the real page's
 * `plan-summary-card` / `dish-card` CSS classes and current shape (no weekday-tab selector —
 * the real app doesn't have one; dishes are tagged "День N" instead). Not wired to tRPC;
 * rendered inside a `pointer-events: none` wrapper (`HowItWorksSection`).
 */
export function MockScreen4Plan() {
  const m = MOCK_PLAN_DATA;

  return (
    <div className="screen-wrapper">
      <div className="app-screen-header">
        <div className="app-screen-brand">
          <span className="app-logo-badge">N</span>
          <span className="app-brand-title">NAVAR</span>
        </div>
        <span className="app-badge-pill">Крок 4 з 5</span>
      </div>

      <div className="app-content" style={{ gap: 12 }}>
        <div className="plan-summary-card">
          <div className="plan-summary-price-row">
            <span className="plan-hero-price">
              Тиждень на {m.totalSpent.toLocaleString("uk-UA")} ₴
            </span>
            <span className="plan-budget-limit">з {m.totalBudget.toLocaleString("uk-UA")} ₴</span>
          </div>
          <div className="plan-pills-row">
            <span className="pill-amber-promo">Зекономлено {m.savedPromo} ₴ на акціях</span>
            <span className="pill-teal-protein">Білок: {m.proteinRange}</span>
          </div>
        </div>

        <div className="conflict-notice-box">
          <span>{m.conflictNotice}</span>
        </div>

        <div className="dishes-list">
          {m.dishes.map((dish, idx) => (
            <div key={dish.id} className="dish-card">
              <div className="dish-card-header">
                <span className="dish-card-title">{dish.name}</span>
                <span className="dish-day-tag">День {idx + 1}</span>
              </div>
              <div className="dish-meta-row">
                <span className="dish-pill-meta">{dish.cookTime}</span>
                <span
                  className="dish-pill-meta"
                  style={{ fontWeight: 800, color: "var(--color-text-hero)" }}
                >
                  {dish.price} ₴
                </span>
                <span className="dish-pill-protein">{dish.protein} г білка · за порцію</span>
                {dish.isPromo && <span className="dish-pill-promo">Акція</span>}
              </div>
              <span className="dish-card__replace">Замінити</span>
            </div>
          ))}
        </div>

        <div className="plan-pinned-actions">
          <button type="button" className="btn-primary">
            <span>Зібрати кошик</span>
          </button>
          <button type="button" className="btn-secondary">
            <span>Дешевше на 300 ₴</span>
          </button>
        </div>
      </div>
    </div>
  );
}
