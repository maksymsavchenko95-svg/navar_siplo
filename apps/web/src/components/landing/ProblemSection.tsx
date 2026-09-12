"use client";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";

export function ProblemSection() {
  const { ref, isInView } = useInView({ threshold: 0.15 });

  return (
    <section
      className={`landing-problem-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      id="problem"
      aria-labelledby="problem-title"
    >
      <div className="landing-section-container">
        <div className="section-eyebrow-center">
          <span className="landing-eyebrow-pill">{LANDING_CONTENT.problem.eyebrow}</span>
        </div>

        <h2 className="editorial-section-title" id="problem-title">
          {LANDING_CONTENT.problem.title}
        </h2>

        <div className="problem-editorial-grid">
          <div className="problem-narrative-col">
            {LANDING_CONTENT.problem.paragraphs.map((p, idx) => (
              <p key={idx} className="editorial-paragraph">
                {p}
              </p>
            ))}

            <div className="cognitive-badges-list">
              <span className="cognitive-badge">1. Баланс білка</span>
              <span className="cognitive-badge">2. Терміни придатності</span>
              <span className="cognitive-badge">3. Залишки вдома</span>
              <span className="cognitive-badge">4. Смаки родини</span>
              <span className="cognitive-badge">5. Залишки в магазині</span>
              <span className="cognitive-badge">6. Акції «Ціни Тижня»</span>
              <span className="cognitive-badge">7. Жорсткий бюджет</span>
            </div>
          </div>

          <div className="problem-quote-col">
            <blockquote className="editorial-pullquote">
              <span className="pullquote-deco" aria-hidden="true">
                &ldquo;
              </span>
              <p className="pullquote-text">{LANDING_CONTENT.problem.quote.text}</p>
              <footer className="pullquote-author">
                <span className="author-dash">—</span> {LANDING_CONTENT.problem.quote.author}
              </footer>
            </blockquote>

            <div className="editorial-stat-callout">
              <div className="callout-value">~51%</div>
              <div className="callout-desc">
                бюджету українських домогосподарств спрямовується на продукти харчування.
                Оптимізація кошика — це пряме збереження сімейних заощаджень.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
