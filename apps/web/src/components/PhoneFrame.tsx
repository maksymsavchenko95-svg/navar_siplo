"use client";

import type { ReactNode } from "react";

/**
 * Realistic smartphone shell drawn entirely in CSS — bezel, dynamic island, hardware
 * buttons, status bar, home indicator. Ported from `designs/navar_design/src/components/
 * PhoneFrame.tsx`. The routed app renders inside `#phone-screen-viewport`.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="phone-shell">
      <div className="phone-screen-container" id="phone-screen">
        <div className="phone-status-bar">
          <span className="status-time">09:41</span>

          <div className="dynamic-island">
            <div className="island-camera-dot" />
            <div className="island-sensor-dot" />
          </div>

          <div className="status-icons">
            <svg className="status-icon-svg" viewBox="0 0 24 24" aria-hidden>
              <rect x="2" y="16" width="3" height="6" rx="1" />
              <rect x="7" y="12" width="3" height="10" rx="1" />
              <rect x="12" y="8" width="3" height="14" rx="1" />
              <rect x="17" y="4" width="3" height="18" rx="1" />
            </svg>
            <svg
              className="status-icon-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3" />
            </svg>
            <svg
              className="status-icon-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="2" y="7" width="16" height="10" rx="2" ry="2" />
              <line x1="22" y1="11" x2="22" y2="13" />
              <rect x="4" y="9" width="10" height="6" fill="currentColor" rx="1" />
            </svg>
          </div>
        </div>

        <div className="phone-viewport" id="phone-screen-viewport">
          {children}
        </div>

        <div className="phone-home-indicator" />
      </div>
    </div>
  );
}
