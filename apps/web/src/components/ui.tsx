"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

/* ---- icons (inline, so no external asset fetches) --------------------- */

export function ArrowRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function ChevronLeft() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/* ---- screen shell (app bar + content) -------------------------------- */

export function ScreenShell({
  step,
  back,
  children,
}: {
  step?: number;
  back?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="screen-wrapper">
      <div className="app-screen-header">
        <div className="app-screen-brand">
          {back != null && (
            <button
              type="button"
              className="app-back-btn"
              aria-label="Назад"
              onClick={() => (back ? router.push(back) : router.back())}
            >
              <ChevronLeft />
            </button>
          )}
          <button
            type="button"
            className="app-brand-home"
            aria-label="До планів"
            onClick={() => router.push("/plans")}
          >
            <span className="app-logo-badge">N</span>
            <span className="app-brand-title">NAVAR</span>
          </button>
        </div>
        {step != null && <span className="app-badge-pill">Крок {step} з 5</span>}
      </div>
      <div className="app-content">{children}</div>
    </div>
  );
}

export function ScreenTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="screen-hero-title">{title}</h1>
      {sub && <p className="screen-sub-title">{sub}</p>}
    </div>
  );
}

/* ---- primary / secondary buttons ------------------------------------ */

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className="btn-primary" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="btn-secondary" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/* ---- state banner (error / auth / no-cart / info) ------------------- */

export function StateBanner({
  tone = "error",
  title,
  children,
}: {
  tone?: "error" | "warn" | "info";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`state-banner state-banner--${tone}`} role="status">
      {title && <span className="state-banner__title">{title}</span>}
      <span>{children}</span>
    </div>
  );
}

/** The reconnect banner shown on any `auth_required` result. */
export function ReconnectBanner({ onReconnect }: { onReconnect: () => void }) {
  return (
    <StateBanner tone="warn" title="Потрібно повторно увійти">
      Сесія «Сільпо» завершилась.{" "}
      <button
        type="button"
        onClick={onReconnect}
        style={{
          border: "none",
          background: "none",
          textDecoration: "underline",
          fontWeight: 800,
          color: "inherit",
          cursor: "pointer",
        }}
      >
        Ввійти з Сільпо
      </button>
    </StateBanner>
  );
}

export function NoCartBanner() {
  return (
    <StateBanner tone="warn" title="Немає кошика">
      У вашому акаунті «Сільпо» ще немає кошика — створіть його в застосунку «Сільпо» і поверніться.
    </StateBanner>
  );
}

/* ---- tactile segmented control ------------------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="tactile-segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`segmented-btn ${value === o.value ? "is-active" : ""}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---- loading dots -------------------------------------------------- */

export function SpinnerDots() {
  return (
    <span className="spinner-dots" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}
