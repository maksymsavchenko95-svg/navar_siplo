"use client";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";
import { CheckIcon, CrossIcon } from "./LandingIcons";

export function DifferentiationSection() {
  const { ref, isInView } = useInView({ threshold: 0.15 });

  return (
    <section
      className={`landing-diff-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      id="comparison"
      aria-labelledby="diff-title"
    >
      <div className="landing-section-container">
        <div className="section-eyebrow-center">
          <span className="landing-eyebrow-pill">{LANDING_CONTENT.differentiation.eyebrow}</span>
        </div>

        <h2 className="editorial-section-title" id="diff-title">
          {LANDING_CONTENT.differentiation.title}
        </h2>

        <div className="diff-table-container">
          <div
            className="diff-table-wrapper"
            role="table"
            aria-label="Порівняння типового асистента та Navar"
          >
            <div className="diff-table-header" role="row">
              <div className="diff-col-dim" role="columnheader">
                Параметр
              </div>
              <div className="diff-col-chat" role="columnheader">
                <span className="chat-header-title">Типовий чат-асистент</span>
                <span className="chat-header-sub">загальні мовні моделі</span>
              </div>
              <div className="diff-col-navar" role="columnheader">
                <div className="navar-header-badge">Продуктовий агент</div>
                <span className="navar-header-title">Navar</span>
                <span className="navar-header-sub">інтеграція з «Сільпо»</span>
              </div>
            </div>

            <div className="diff-table-body" role="rowgroup">
              {LANDING_CONTENT.differentiation.table.map((row, idx) => (
                <div key={idx} className="diff-table-row" role="row">
                  <div className="diff-cell-dim" role="rowheader">
                    <span className="dim-title">{row.dimension}</span>
                  </div>

                  <div className="diff-cell-chat" role="cell">
                    <div className="cell-content">
                      <CrossIcon className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                      <span>{row.chatbot}</span>
                    </div>
                  </div>

                  <div className="diff-cell-navar" role="cell">
                    <div className="cell-content-navar">
                      <CheckIcon className="w-4 h-4 text-herb-dark shrink-0 mt-0.5" />
                      <span className="navar-text-bold">{row.navar}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
