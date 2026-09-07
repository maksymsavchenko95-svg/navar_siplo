"use client";

import type { ReactNode } from "react";

import { trpc } from "@/lib/trpc";
import { SpinnerDots } from "@/components/ui";

/**
 * Auth gate (`FR-AUTH-002`, `AC-P0-01`). No session → a login card with «Ввійти з Сільпо».
 * Session → the app (logout lives in the screen header). The Silpo token never reaches the
 * client — only an httpOnly `navar_sid` session cookie.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = trpc.auth.status.useQuery();

  const startLogin = trpc.auth.startLogin.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
  });

  if (status.isLoading) {
    return (
      <div className="screen-wrapper">
        <div
          className="app-content"
          style={{ alignItems: "center", justifyContent: "center", flex: 1 }}
        >
          <SpinnerDots />
        </div>
      </div>
    );
  }

  if (!status.data?.connected) {
    return (
      <div className="screen-wrapper">
        <div
          className="app-content"
          style={{ alignItems: "center", justifyContent: "center", gap: 18, flex: 1 }}
        >
          <div className="app-logo-badge" style={{ width: 44, height: 44, fontSize: 22 }}>
            N
          </div>
          <h1 className="screen-hero-title" style={{ textAlign: "center" }}>
            Navar
          </h1>
          <p className="screen-sub-title" style={{ textAlign: "center", maxWidth: 300 }}>
            Тижневий продуктовий план на основі ваших покупок у «Сільпо» — у межах бюджету, без
            порушення обмежень.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => startLogin.mutate()}
            disabled={startLogin.isPending}
          >
            {startLogin.isPending ? <SpinnerDots /> : "Ввійти з Сільпо"}
          </button>
          {startLogin.isError && (
            <p style={{ color: "var(--color-error)", fontSize: 12 }}>
              Не вдалося почати вхід. Спробуйте ще раз.
            </p>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
