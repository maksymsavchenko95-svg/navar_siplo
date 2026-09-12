"use client";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";
import { CodeIcon, ScaleIcon, ShieldIcon } from "./LandingIcons";

export function TrustEngineeringSection() {
  const { ref, isInView } = useInView({ threshold: 0.15 });

  const getCardIcon = (idx: number) => {
    switch (idx) {
      case 0:
        return <ShieldIcon className="w-5 h-5 text-silpo-orange" />;
      case 1:
        return <ScaleIcon className="w-5 h-5 text-silpo-orange" />;
      case 2:
        return <CodeIcon className="w-5 h-5 text-silpo-orange" />;
      default:
        return <ShieldIcon className="w-5 h-5 text-silpo-orange" />;
    }
  };

  return (
    <section
      className={`landing-trust-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      id="trust"
      aria-labelledby="trust-title"
    >
      <div className="landing-section-container">
        <div className="section-eyebrow-center">
          <span className="landing-eyebrow-pill">{LANDING_CONTENT.trust.eyebrow}</span>
        </div>

        <h2 className="editorial-section-title" id="trust-title">
          {LANDING_CONTENT.trust.title}
        </h2>

        <div className="trust-cards-grid">
          {LANDING_CONTENT.trust.cards.map((card, idx) => (
            <div key={idx} className="trust-card">
              <div className="trust-card-header">
                <div className="trust-card-icon-box">{getCardIcon(idx)}</div>
                <span className="trust-card-tag">{card.tag}</span>
              </div>

              <h3 className="trust-card-title">{card.title}</h3>
              <p className="trust-card-desc">{card.description}</p>

              {idx === 1 && (
                <div className="seed-verification-chip">
                  <span className="seed-code">seed: 0x8F92E</span>
                  <span className="seed-arrow">→</span>
                  <span className="seed-status">Hash verified ✓</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="trace-terminal-card">
          <div className="terminal-header">
            <div className="terminal-dots">
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
            </div>
            <div className="terminal-title">mcp.silpo.ua/mcp · JSON-RPC 2.0 Audit Log</div>
            <div className="terminal-badge">LIVE TRACE</div>
          </div>

          <div className="terminal-content">
            <div className="terminal-block request">
              <div className="terminal-label">
                // 1. tools/call запит агента до інфраструктури «Сільпо»
              </div>
              <pre>
                <code>{LANDING_CONTENT.trust.traceSnippet.call}</code>
              </pre>
            </div>

            <div className="terminal-block response">
              <div className="terminal-label">
                // 2. Детермінована перевірена відповідь MCP сервера
              </div>
              <pre>
                <code>{LANDING_CONTENT.trust.traceSnippet.result}</code>
              </pre>
            </div>
          </div>

          <div className="terminal-footer">
            <span className="terminal-caption">{LANDING_CONTENT.trust.traceSnippet.caption}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
