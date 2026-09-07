"use client";

import type { ReactNode } from "react";
import { Fragment, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { PITCH_SECTIONS, screenIdForPath } from "@/lib/pitch";
import { PhoneFrame } from "@/components/PhoneFrame";

/**
 * The two-column presentation shell (ported from `designs/navar_design/src/App.tsx`, minus
 * the IntersectionObserver and the bottom screen-switcher). Left: a sticky iPhone frame
 * running the real routed app. Right: the five pitch sections — the one matching the
 * current route gets `.is-current` and is scrolled into view. Navigation is one-way: the
 * phone's own buttons change the route; the right column follows.
 */
export function PresentationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const activeId = screenIdForPath(pathname);

  const firstRun = useRef(true);
  useEffect(() => {
    document.getElementById(`pitch-section-${activeId}`)?.scrollIntoView({
      behavior: firstRun.current ? "auto" : "smooth",
      block: "start",
    });
    document.getElementById("phone-screen-viewport")?.scrollTo({ top: 0 });
    firstRun.current = false;
  }, [activeId]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <PresentationHeader />

      <main className="presentation-container" id="presentation-main">
        <section className="phone-column-pedestal" aria-label="Інтерактивний застосунок">
          <PhoneFrame>{children}</PhoneFrame>
        </section>

        <section className="sections-column" aria-label="Опис концепції">
          {PITCH_SECTIONS.map((section) => (
            <article
              key={section.id}
              id={`pitch-section-${section.id}`}
              data-screen-id={section.id}
              className={`pitch-section ${section.id === activeId ? "is-current" : ""}`}
            >
              <div className="pitch-section-header">
                <div className="pitch-step-badge">
                  <span className="pitch-step-number">{section.id}</span>
                  <span>{section.badge}</span>
                </div>
                <span className="pitch-interactive-hint">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                    <line x1="12" y1="18" x2="12.01" y2="18" />
                  </svg>
                  <span>Показано в телефоні зліва</span>
                </span>
              </div>

              <h2 className="pitch-headline">{section.headline}</h2>

              <div className="pitch-paragraphs">
                {section.paragraphs.map((p, i) => (
                  <p key={i}>{renderBold(p)}</p>
                ))}
              </div>

              <div className="pitch-annotations">
                <div className="pitch-annotations-title">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>Ключові деталі інтерфейсу</span>
                </div>
                {section.annotations.map((a, i) => (
                  <div key={i} className="pitch-annotation-item">
                    <div className="pitch-annotation-dot" />
                    <div>
                      <span className="pitch-annotation-label">{a.label}:</span>
                      <span className="pitch-annotation-text">{a.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

function renderBold(text: string): ReactNode {
  return text
    .split(/(\*\*.*?\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

function PresentationHeader() {
  const status = trpc.auth.status.useQuery();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void utils.invalidate();
      window.location.assign("/");
    },
  });

  return (
    <header className="presentation-header" id="header-bar">
      <div className="presentation-header-inner">
        <div className="brand-wrapper">
          <div className="brand-logo-box" aria-hidden>
            N
          </div>
          <div>
            <div className="brand-name">NAVAR</div>
            <div className="brand-tagline">
              Щотижневий продуктовий агент для українського ритейлу
            </div>
          </div>
        </div>

        {status.data?.connected && (
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            style={{
              border: "1px solid var(--color-border)",
              background: "transparent",
              borderRadius: "var(--radius-pill)",
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            Вийти
          </button>
        )}
      </div>
    </header>
  );
}
