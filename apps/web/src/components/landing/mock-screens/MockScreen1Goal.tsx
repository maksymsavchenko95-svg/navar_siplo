import { MOCK_GOAL_CARDS } from "./mock-data";

/**
 * Static illustration of `/goal` for the landing page's "how it works" section — reuses the
 * real wizard's `goal-card*` CSS classes. Not wired to tRPC; rendered inside a
 * `pointer-events: none` wrapper (`HowItWorksSection`), so no interactivity is needed.
 */
export function MockScreen1Goal({ mode = "form" }: { mode?: "form" | "routine" }) {
  return (
    <div className="screen-wrapper">
      <div className="app-screen-header">
        <div className="app-screen-brand">
          <span className="app-logo-badge">N</span>
          <span className="app-brand-title">NAVAR</span>
        </div>
        <span className="app-badge-pill">Крок 1 з 5</span>
      </div>

      <div className="app-content">
        <div>
          <h1 className="screen-hero-title">Що плануємо?</h1>
          <p className="screen-sub-title">
            Оберіть формат тижневого кошика. Алгоритм підлаштує меню під ваші завдання.
          </p>
        </div>

        <div className="goal-card-stack">
          {MOCK_GOAL_CARDS.map((card) => {
            const isSelected = mode === card.id;
            return (
              <div key={card.id} className={`goal-card ${isSelected ? "is-selected" : ""}`}>
                <div className="goal-card-top">
                  <div className="goal-card-icon-box">
                    {card.id === "routine" ? (
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 11v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        <circle cx="12" cy="15" r="1.5" />
                        <path d="M8 3v2M16 3v2" />
                      </svg>
                    ) : (
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v10" />
                        <path d="M7 12h10" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </div>

                  <div className="goal-radio-circle">
                    {isSelected && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>

                <div>
                  <div className="goal-card-title">{card.title}</div>
                  <div className="goal-card-subtitle">{card.subtitle}</div>
                </div>

                <div className="goal-card-desc">{card.description}</div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: "auto", paddingTop: 16 }}>
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
  );
}
