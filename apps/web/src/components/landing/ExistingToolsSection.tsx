"use client";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";
import { CartIcon, ChatIcon, RecipeIcon, SparklesIcon } from "./LandingIcons";

export function ExistingToolsSection() {
  const { ref, isInView } = useInView({ threshold: 0.15 });

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case "chat":
        return <ChatIcon className="w-5 h-5 text-silpo-orange" />;
      case "recipe":
        return <RecipeIcon className="w-5 h-5 text-silpo-orange" />;
      case "cart":
        return <CartIcon className="w-5 h-5 text-silpo-orange" />;
      default:
        return <SparklesIcon className="w-5 h-5 text-silpo-orange" />;
    }
  };

  return (
    <section
      className={`landing-antipos-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      id="anti-positioning"
      aria-labelledby="antipos-title"
    >
      <div className="landing-section-container">
        <div className="section-eyebrow-center">
          <span className="landing-eyebrow-pill">{LANDING_CONTENT.antiPositioning.eyebrow}</span>
        </div>

        <h2 className="editorial-section-title" id="antipos-title">
          {LANDING_CONTENT.antiPositioning.title}
        </h2>

        <p className="editorial-section-sub">{LANDING_CONTENT.antiPositioning.subtitle}</p>

        <div className="limitation-cards-grid">
          {LANDING_CONTENT.antiPositioning.cards.map((card, idx) => (
            <div key={idx} className="limitation-card">
              <div className="limitation-card-icon-box">{getIcon(card.icon)}</div>
              <h3 className="limitation-card-title">{card.title}</h3>
              <p className="limitation-card-desc">{card.description}</p>
            </div>
          ))}
        </div>

        <div className="antipos-banner-box">
          <div className="antipos-banner-badge">
            <span className="dot-pulse" aria-hidden="true" />
            <span>Головна відмінність</span>
          </div>

          <h3 className="antipos-banner-lead">{LANDING_CONTENT.antiPositioning.bannerLead}</h3>

          <p className="antipos-banner-text">{LANDING_CONTENT.antiPositioning.bannerBody}</p>
        </div>
      </div>
    </section>
  );
}
