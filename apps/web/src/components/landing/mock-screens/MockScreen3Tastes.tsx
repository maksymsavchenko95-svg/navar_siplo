import { MOCK_TASTES } from "./mock-data";

/**
 * Static illustration of `/tastes` — reuses the real wizard's `Portrait` CSS classes
 * (`apps/web/src/app/tastes/page.tsx`). Not wired to tRPC; rendered inside a
 * `pointer-events: none` wrapper (`HowItWorksSection`).
 */
export function MockScreen3Tastes() {
  return (
    <div className="screen-wrapper">
      <div className="app-screen-header">
        <div className="app-screen-brand">
          <span className="app-logo-badge">N</span>
          <span className="app-brand-title">NAVAR</span>
        </div>
        <span className="app-badge-pill">Крок 3 з 5</span>
      </div>

      <div className="app-content">
        <div>
          <h1 className="screen-hero-title">Здається, ми вас уже трохи знаємо</h1>
          <p className="screen-sub-title">Зібрали з ваших чеків. Виправте, якщо помилились.</p>
        </div>

        <div className="tastes-group">
          <div className="tastes-group-title">Часто берете</div>
          <div className="chips-cloud">
            {MOCK_TASTES.oftenBought.map((item) => (
              <span key={item} className="chip-active">
                <span>{item}</span>
                <span className="chip-remove-btn">×</span>
              </span>
            ))}
          </div>
        </div>

        <div className="tastes-group">
          <div className="tastes-group-title">Схоже, не берете</div>
          <div className="chips-cloud">
            {MOCK_TASTES.rarelyBought.map((item) => (
              <span key={item} className="chip-muted">
                <span>{item}</span>
                <span className="chip-add-icon">+</span>
              </span>
            ))}
          </div>
        </div>

        <div className="allergies-container">
          <div className="allergies-title-row">
            <div className="allergies-title">Алергії та обмеження</div>
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--color-warning-text)" }}>
              Суворе виключення
            </span>
          </div>
          <div className="chips-cloud">
            {MOCK_TASTES.allergies.map((item) => (
              <span key={item} className="chip-allergy">
                <span>{item}</span>
                <span className="chip-remove-btn">×</span>
              </span>
            ))}
            <span className="chip-add-new">+ Додати</span>
          </div>
        </div>

        <div style={{ marginTop: "auto", paddingTop: 12 }}>
          <button type="button" className="btn-primary">
            <span>Скласти план</span>
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
  );
}
