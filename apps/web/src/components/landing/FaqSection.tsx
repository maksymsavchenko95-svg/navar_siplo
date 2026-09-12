"use client";

import { useState } from "react";

import { LANDING_CONTENT, type FaqItem } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";
import { ChevronDownIcon } from "./LandingIcons";

export function FaqSection() {
  const { ref, isInView } = useInView({ threshold: 0.15 });
  const [openId, setOpenId] = useState<string | null>("faq-1");

  const toggleItem = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <section
      className={`landing-faq-section ${isInView ? "reveal-in" : ""}`}
      ref={ref}
      id="faq"
      aria-labelledby="faq-title"
    >
      <div className="landing-section-container">
        <div className="section-eyebrow-center">
          <span className="landing-eyebrow-pill">Відповіді на запитання</span>
        </div>

        <h2 className="editorial-section-title" id="faq-title">
          Часті питання про Navar
        </h2>

        <div className="faq-accordion-container" role="region" aria-label="Часті запитання">
          {LANDING_CONTENT.faq.map((item: FaqItem) => {
            const isOpen = openId === item.id;
            return (
              <div key={item.id} className={`faq-item-card ${isOpen ? "is-expanded" : ""}`}>
                <button
                  type="button"
                  className="faq-question-btn"
                  onClick={() => toggleItem(item.id)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${item.id}`}
                  id={`faq-btn-${item.id}`}
                >
                  <span className="faq-question-text">{item.question}</span>
                  <span
                    className={`faq-chevron-box ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    <ChevronDownIcon className="w-5 h-5 text-stone-500" />
                  </span>
                </button>

                <div
                  id={`faq-answer-${item.id}`}
                  role="region"
                  aria-labelledby={`faq-btn-${item.id}`}
                  className={`faq-answer-collapse ${isOpen ? "is-open" : ""}`}
                >
                  <div className="faq-answer-inner">
                    <p className="faq-answer-text">{item.answer}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
