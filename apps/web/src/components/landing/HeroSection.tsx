"use client";

import { useEffect, useState } from "react";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { ArrowRightIcon, SparklesIcon } from "./LandingIcons";

export function HeroSection({ onLogin }: { onLogin: () => void }) {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const tiltDeg = Math.max(0, 3.5 - scrollY * 0.01);
  const translateYOffset = Math.min(60, scrollY * 0.08);

  return (
    <section className="landing-hero-section" id="hero" aria-label="Вступ та головна пропозиція">
      <div className="landing-hero-container">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow-pill">
            <SparklesIcon className="w-3.5 h-3.5" />
            <span>{LANDING_CONTENT.brand.heroEyebrow}</span>
          </div>

          <h1 className="landing-hero-title">
            <span>{LANDING_CONTENT.brand.heroTitleLead} </span>
            <span className="text-gradient">{LANDING_CONTENT.brand.heroTitleTail}</span>
          </h1>

          <p className="landing-hero-sub">{LANDING_CONTENT.brand.heroSubtitle}</p>

          <div className="landing-hero-cta-group">
            <button
              type="button"
              className="landing-btn-primary landing-btn-hero"
              onClick={onLogin}
              id="hero-login-button"
            >
              <span>{LANDING_CONTENT.brand.primaryCta}</span>
              <ArrowRightIcon className="w-4 h-4" />
            </button>

            <a href="#how-it-works" className="landing-btn-ghost">
              <span>{LANDING_CONTENT.brand.ghostCta}</span>
            </a>
          </div>

          <div className="landing-hero-reassurance">
            <span className="reassurance-dot" aria-hidden="true" />
            <span>{LANDING_CONTENT.brand.oauthNote}</span>
          </div>
        </div>

        <div
          className="landing-hero-mock-wrapper"
          style={{
            transform: `perspective(1000px) rotateY(-${tiltDeg}deg) rotateX(${tiltDeg * 0.5}deg) translateY(${translateYOffset}px)`,
          }}
        >
          <div className="hero-mock-card" id="hero-plan-mock">
            <div className="hero-mock-glow" aria-hidden="true" />

            <div className="hero-mock-header">
              <div className="hero-mock-badge-live">
                <span className="live-pulsing-dot" />
                <span>Згенеровано агентом</span>
              </div>
              <span className="hero-mock-seed">seed: 0x8F92E</span>
            </div>

            <div className="hero-mock-price-block">
              <div className="hero-mock-price-row">
                <span className="hero-mock-price-val">1 840 ₴</span>
                <span className="hero-mock-price-period">/ тиждень</span>
              </div>
              <div className="hero-mock-budget-line">
                <span>Бюджет: 2 000 ₴</span>
                <span className="budget-divider">·</span>
                <span className="hero-mock-savings">Залишок: 160 ₴</span>
              </div>
            </div>

            <div className="hero-mock-pills-row">
              <span className="hero-pill-amber">
                <span className="pill-dot-amber" />
                Акції в кошику: 55 %
              </span>
              <span className="hero-pill-teal">
                <span className="pill-dot-teal" />
                Білок: 132 г / день
              </span>
            </div>

            <div className="hero-mock-weekday-rail" aria-label="Дні тижня">
              <div className="mock-day-pill is-active">
                <span className="day-name">ПН</span>
                <span className="day-dot" />
              </div>
              <div className="mock-day-pill">
                <span className="day-name">ВТ</span>
                <span className="day-dot" />
              </div>
              <div className="mock-day-pill">
                <span className="day-name">СР</span>
                <span className="day-dot" />
              </div>
              <div className="mock-day-pill">
                <span className="day-name">ЧТ</span>
                <span className="day-dot" />
              </div>
              <div className="mock-day-pill">
                <span className="day-name">ПТ</span>
                <span className="day-dot" />
              </div>
            </div>

            <div className="hero-mock-dishes-list">
              <div className="mock-dish-row">
                <div className="mock-dish-info">
                  <div className="mock-dish-title">Лососевий стейк із печеним броколі</div>
                  <div className="mock-dish-sub">520 ккал · 42 г білка · 25 хв</div>
                </div>
                <span className="mock-dish-tag promo">Акція -32%</span>
              </div>

              <div className="mock-dish-row">
                <div className="mock-dish-info">
                  <div className="mock-dish-title">Гречаний боул із курячим філе й авокадо</div>
                  <div className="mock-dish-sub">480 ккал · 38 г білка · 20 хв</div>
                </div>
                <span className="mock-dish-tag loyalty">Власний Рахунок</span>
              </div>

              <div className="mock-dish-row">
                <div className="mock-dish-info">
                  <div className="mock-dish-title">Запечена індичка з овочевим соте</div>
                  <div className="mock-dish-sub">440 ккал · 36 г білка · 30 хв</div>
                </div>
                <span className="mock-dish-tag price">Ціна Тижня</span>
              </div>
            </div>

            <div className="hero-mock-footer">
              <div className="mock-footer-items">
                <span>18 товарів у кошику «Сільпо»</span>
                <span>Списано: 600 балабонусів</span>
              </div>
              <div className="mock-footer-status">
                <span className="check-dot">✓</span>
                <span>Готово до чекауту</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
