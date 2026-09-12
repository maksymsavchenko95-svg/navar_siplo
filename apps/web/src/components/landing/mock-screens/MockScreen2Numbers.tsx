import { MOCK_NUMBERS_FORM } from "./mock-data";

/**
 * Static illustration of `/numbers` — reuses the real wizard's CSS classes and current
 * behavior: the household-size stepper only appears for `routine` (form goal always plans
 * for one person — see `apps/api/src/plan.ts`'s `randomSeed`/servings logic and
 * `apps/web/src/app/numbers/page.tsx`). Not wired to tRPC; rendered inside a
 * `pointer-events: none` wrapper (`HowItWorksSection`).
 */
export function MockScreen2Numbers({ mode = "form" }: { mode?: "form" | "routine" }) {
  const m = MOCK_NUMBERS_FORM;
  const budgetFillPct = ((m.budget - m.budgetMin) / (m.budgetMax - m.budgetMin)) * 100;

  return (
    <div className="screen-wrapper">
      <div className="app-screen-header">
        <div className="app-screen-brand">
          <span className="app-logo-badge">N</span>
          <span className="app-brand-title">NAVAR</span>
        </div>
        <span className="app-badge-pill">Крок 2 з 5</span>
      </div>

      <div className="app-content">
        <div>
          <h1 className="screen-hero-title">Кілька цифр</h1>
          <p className="screen-sub-title">
            Використовуємо для розрахунку ситного коридору та вартості кошика.
          </p>
        </div>

        <div className="form-grid">
          <div className="form-card-field">
            <div className="field-label-row">
              <span className="field-label">Бюджет на тиждень</span>
              <span className="field-value-bold">{m.budget.toLocaleString("uk-UA")} ₴</span>
            </div>
            <div className="budget-slider-container">
              <input
                type="range"
                min={m.budgetMin}
                max={m.budgetMax}
                value={m.budget}
                readOnly
                className="custom-range-slider"
                style={{
                  background: `linear-gradient(to right, var(--color-silpo-orange) 0%, var(--color-silpo-orange) ${budgetFillPct}%, #e5e0d8 ${budgetFillPct}%, #e5e0d8 100%)`,
                }}
              />
              <div className="slider-bounds">
                <span>{m.budgetMin.toLocaleString("uk-UA")} ₴</span>
                <span>{m.budgetMax.toLocaleString("uk-UA")} ₴</span>
              </div>
            </div>
          </div>

          {mode === "routine" && (
            <div className="form-card-field">
              <div className="field-label-row">
                <span className="field-label">Скільки осіб</span>
                <span className="field-value-bold">3 особи</span>
              </div>
              <div className="form-2col-row">
                <div className="tactile-input-card">
                  <span className="tactile-input-label">Дорослі</span>
                  <div className="stepper" role="group">
                    <span className="stepper-btn">−</span>
                    <span className="stepper-value">2</span>
                    <span className="stepper-btn">+</span>
                  </div>
                </div>
                <div className="tactile-input-card">
                  <span className="tactile-input-label">Діти</span>
                  <div className="stepper" role="group">
                    <span className="stepper-btn">−</span>
                    <span className="stepper-value">1</span>
                    <span className="stepper-btn">+</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mode === "form" && (
            <>
              <div className="form-2col-row">
                <div className="form-card-field">
                  <span className="field-label">Стать</span>
                  <div className="tactile-segmented">
                    <span className="segmented-btn">Ж</span>
                    <span className="segmented-btn is-active">Ч</span>
                  </div>
                </div>
                <div className="tactile-input-card">
                  <span className="tactile-input-label">Вік</span>
                  <div className="tactile-input-wrapper">
                    <span className="tactile-numeric-input">{m.age}</span>
                    <span className="tactile-input-unit">р.</span>
                  </div>
                </div>
              </div>

              <div className="form-2col-row">
                <div className="tactile-input-card">
                  <span className="tactile-input-label">Вага</span>
                  <div className="tactile-input-wrapper">
                    <span className="tactile-numeric-input">{m.weight}</span>
                    <span className="tactile-input-unit">кг</span>
                  </div>
                </div>
                <div className="tactile-input-card">
                  <span className="tactile-input-label">Зріст</span>
                  <div className="tactile-input-wrapper">
                    <span className="tactile-numeric-input">{m.height}</span>
                    <span className="tactile-input-unit">см</span>
                  </div>
                </div>
              </div>

              <div className="form-card-field">
                <span className="field-label">Активність</span>
                <div className="tactile-segmented">
                  <span className="segmented-btn">Низька</span>
                  <span className="segmented-btn is-active">Середня</span>
                  <span className="segmented-btn">Висока</span>
                </div>
              </div>

              <div className="form-card-field">
                <span className="field-label">Напрям</span>
                <div className="tactile-segmented">
                  <span className="segmented-btn">Набір</span>
                  <span className="segmented-btn is-active">Утримання</span>
                  <span className="segmented-btn">Зниження</span>
                </div>
              </div>

              <div className="frosted-glass-dark">
                <div className="hero-computed-header">
                  <div className="hero-computed-title-wrap">
                    <span className="hero-computed-dot" />
                    <span className="hero-computed-title">Ваша ціль</span>
                  </div>
                </div>
                <div className="hero-metrics-grid">
                  <div className="hero-metric-tile">
                    <div className="hero-metric-tile-header">
                      <span className="hero-metric-label">Білок</span>
                      <span className="hero-metric-badge-mini">мінімум</span>
                    </div>
                    <div className="hero-metric-value-display">
                      <span className="hero-metric-num">{m.computedProtein}</span>
                      <span className="hero-metric-unit">г / добу</span>
                    </div>
                  </div>
                  <div className="hero-metric-tile">
                    <div className="hero-metric-tile-header">
                      <span className="hero-metric-label">Калорії</span>
                      <span className="hero-metric-badge-mini">±15 %</span>
                    </div>
                    <div className="hero-metric-value-display">
                      <span className="hero-metric-num">
                        {m.computedCalories.toLocaleString("uk-UA")}
                      </span>
                      <span className="hero-metric-unit">ккал</span>
                    </div>
                  </div>
                </div>
                <div className="hero-computed-footer-note">
                  Розраховано автоматично з ваших даних — вводити цифри вручну не потрібно.
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: 8, paddingTop: 8 }}>
            <button type="button" className="btn-primary">
              <span>Далі</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
