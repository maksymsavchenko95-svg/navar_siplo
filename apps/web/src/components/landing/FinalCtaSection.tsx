"use client";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";
import { ArrowRightIcon, SparklesIcon } from "./LandingIcons";

export function FinalCtaSection({ onLogin }: { onLogin: () => void }) {
  const { ref, isInView } = useInView({ threshold: 0.2 });

  return (
    <section
      className={`landing-final-cta-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      aria-label="Заклик до дії"
    >
      <div className="landing-section-container">
        <div className="final-cta-banner">
          <div className="final-cta-glow" aria-hidden="true" />

          <div className="final-cta-content">
            <div className="final-cta-pill">
              <SparklesIcon className="w-4 h-4 text-silpo-orange" />
              <span>Тижневе планування без рутини</span>
            </div>

            <h2 className="final-cta-headline">Готові побачити свій тиждень?</h2>

            <p className="final-cta-sub">
              Підключіть «Власний Рахунок», щоб отримати персональний збалансований план вечерь під
              ваш бюджет уже зараз.
            </p>

            <div className="final-cta-action-wrap">
              <button
                type="button"
                className="landing-btn-primary landing-btn-large"
                onClick={onLogin}
                id="final-login-button"
              >
                <span>{LANDING_CONTENT.brand.primaryCta}</span>
                <ArrowRightIcon className="w-5 h-5" />
              </button>
            </div>

            <p className="final-cta-reassurance">{LANDING_CONTENT.brand.oauthNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
