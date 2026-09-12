"use client";

import { useEffect, useState } from "react";

import { LANDING_CONTENT } from "@/lib/landing-content";

export function LandingHeader({ onLogin }: { onLogin: () => void }) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 80);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`landing-header ${isScrolled ? "is-scrolled" : ""}`}
      id="landing-header"
      role="banner"
    >
      <div className="landing-header-inner">
        <a href="#hero" className="landing-brand-wrapper" aria-label="Navar — на головну">
          <div className="landing-brand-tile" aria-hidden="true">
            N
          </div>
          <div className="landing-brand-text">
            <span className="landing-brand-title">{LANDING_CONTENT.brand.name}</span>
            <span className="landing-brand-sub">{LANDING_CONTENT.brand.tagline}</span>
          </div>
        </a>

        <nav className="landing-nav-links" aria-label="Розділи сторінки">
          <a href="#how-it-works" className="landing-nav-link">
            Як це працює
          </a>
          <a href="#anti-positioning" className="landing-nav-link">
            Чому не чат
          </a>
          <a href="#comparison" className="landing-nav-link">
            Порівняння
          </a>
          <a href="#trust" className="landing-nav-link">
            Архітектура
          </a>
          <a href="#faq" className="landing-nav-link">
            Питання
          </a>
        </nav>

        <div className="landing-header-actions">
          <button
            type="button"
            className="landing-btn-primary"
            onClick={onLogin}
            id="header-login-button"
            aria-label="Увійти через Власний Рахунок Сільпо"
          >
            <span>{LANDING_CONTENT.brand.primaryCta}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
