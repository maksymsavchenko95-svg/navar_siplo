"use client";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";
import { AlertCircleIcon, ShieldIcon } from "./LandingIcons";

export function SafetySection() {
  const { ref, isInView } = useInView({ threshold: 0.15 });

  return (
    <section
      className={`landing-safety-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      id="safety"
      aria-labelledby="safety-title"
    >
      <div className="landing-section-container">
        <div className="safety-card-borsch">
          <div className="safety-card-header">
            <div className="safety-icon-wrapper">
              <ShieldIcon className="w-6 h-6 text-borsch" />
            </div>
            <div>
              <span className="safety-eyebrow">{LANDING_CONTENT.safety.eyebrow}</span>
              <h2 className="safety-card-title" id="safety-title">
                {LANDING_CONTENT.safety.title}
              </h2>
            </div>
          </div>

          <div className="safety-card-body">
            {LANDING_CONTENT.safety.body.map((paragraph, idx) => (
              <p key={idx} className="safety-paragraph">
                {paragraph}
              </p>
            ))}

            <div className="safety-badges-row">
              <div className="safety-pill">
                <span className="safety-check-mark">✓</span>
                <span>Fail-closed верифікація</span>
              </div>
              <div className="safety-pill">
                <span className="safety-check-mark">✓</span>
                <span>Двохетапний фільтр SKU</span>
              </div>
              <div className="safety-pill">
                <span className="safety-check-mark">✓</span>
                <span>Безпечні заміни брендів</span>
              </div>
            </div>
          </div>

          <div className="safety-disclaimer-box">
            <AlertCircleIcon className="text-borsch" strokeWidth={2.5} />
            <p className="safety-disclaimer-text">{LANDING_CONTENT.safety.disclaimer}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
