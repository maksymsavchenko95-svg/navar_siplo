"use client";

import { Fragment } from "react";

import { LANDING_CONTENT } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";
import { MockPhoneFrame } from "./mock-screens/MockPhoneFrame";
import { MockScreen1Goal } from "./mock-screens/MockScreen1Goal";
import { MockScreen2Numbers } from "./mock-screens/MockScreen2Numbers";
import { MockScreen3Tastes } from "./mock-screens/MockScreen3Tastes";
import { MockScreen4Plan } from "./mock-screens/MockScreen4Plan";
import { MockScreen5Cart } from "./mock-screens/MockScreen5Cart";

/** A non-interactive, scaled-down phone mockup — illustration only (`pointer-events: none`). */
function MiniAppScreen({
  stepIndex,
  mode = "form",
  scale = 0.85,
}: {
  stepIndex: number;
  mode?: "form" | "routine";
  scale?: number;
}) {
  return (
    <div
      className="mini-screen-wrapper"
      style={{ width: `${340 * scale}px`, height: `${640 * scale}px` }}
      aria-hidden="true"
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
          width: 340,
          height: 640,
          pointerEvents: "none",
        }}
      >
        <MockPhoneFrame>
          {stepIndex === 1 && <MockScreen1Goal mode={mode} />}
          {stepIndex === 2 && <MockScreen2Numbers mode={mode} />}
          {stepIndex === 3 && <MockScreen3Tastes />}
          {stepIndex === 4 && <MockScreen4Plan />}
          {stepIndex === 5 && <MockScreen5Cart />}
        </MockPhoneFrame>
      </div>
    </div>
  );
}

export function HowItWorksSection() {
  const { ref, isInView } = useInView({ threshold: 0.1 });

  return (
    <section
      className={`landing-how-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      id="how-it-works"
      aria-labelledby="how-title"
    >
      <div className="landing-section-container">
        <div className="section-eyebrow-center">
          <span className="landing-eyebrow-pill">{LANDING_CONTENT.howItWorks.eyebrow}</span>
        </div>

        <h2 className="editorial-section-title" id="how-title">
          {LANDING_CONTENT.howItWorks.title}
        </h2>

        <div className="how-steps-flow">
          {LANDING_CONTENT.howItWorks.steps.map((stepItem, idx) => {
            const isEven = idx % 2 === 1;

            if (stepItem.step === 2) {
              return (
                <Fragment key={stepItem.step}>
                  <div className={`how-step-card ${isEven ? "step-reversed" : ""}`}>
                    <div className="step-text-col">
                      <div className="step-badge-row">
                        <span className="step-number-tile">2</span>
                        <span className="step-badge-pill">Спортивна форма</span>
                      </div>
                      <h3 className="step-title">{stepItem.title}</h3>
                      <p className="step-desc">
                        Для тих, хто тренується або тримає форму. Вкажіть вагу, зріст та активність
                        — алгоритм миттєво розрахує вашу норму калорій та мінімум білка на день.
                      </p>
                      <ul className="step-details-list">
                        <li className="step-detail-item">Точний розрахунок БЖВ</li>
                        <li className="step-detail-item">Врахування напрямку (набір/сушка)</li>
                      </ul>
                    </div>
                    <div className="step-visual-col">
                      <MiniAppScreen stepIndex={2} mode="form" />
                    </div>
                  </div>

                  <div className={`how-step-card ${!isEven ? "step-reversed" : ""}`}>
                    <div className="step-text-col">
                      <div className="step-badge-row">
                        <span className="step-number-tile">Або</span>
                        <span
                          className="step-badge-pill"
                          style={{
                            backgroundColor: "var(--color-silpo-orange)",
                            color: "#fff",
                            borderColor: "var(--color-silpo-orange)",
                          }}
                        >
                          Сімейна рутина
                        </span>
                      </div>
                      <h3 className="step-title">Планування на родину</h3>
                      <p className="step-desc">
                        Знімає головний біль сімейних закупівель. Вкажіть кількість дорослих і дітей
                        — Navar збере оптимальний кошик, щоб усім вистачило їжі на весь тиждень, не
                        виходячи за рамки бюджету.
                      </p>
                      <ul className="step-details-list">
                        <li className="step-detail-item">Автоматичне масштабування порцій</li>
                        <li className="step-detail-item">Бюджет — головне обмеження</li>
                      </ul>
                    </div>
                    <div className="step-visual-col">
                      <MiniAppScreen stepIndex={2} mode="routine" />
                    </div>
                  </div>
                </Fragment>
              );
            }

            return (
              <div
                key={stepItem.step}
                className={`how-step-card ${idx > 1 ? (idx % 2 === 0 ? "step-reversed" : "") : isEven ? "step-reversed" : ""}`}
              >
                <div className="step-text-col">
                  <div className="step-badge-row">
                    <span className="step-number-tile">{stepItem.step}</span>
                    <span className="step-badge-pill">{stepItem.badge}</span>
                  </div>

                  <h3 className="step-title">{stepItem.title}</h3>
                  <p className="step-desc">{stepItem.description}</p>

                  <ul className="step-details-list">
                    {stepItem.details.map((detail, dIdx) => (
                      <li key={dIdx} className="step-detail-item">
                        {detail}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="step-visual-col">
                  <MiniAppScreen stepIndex={stepItem.step} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
