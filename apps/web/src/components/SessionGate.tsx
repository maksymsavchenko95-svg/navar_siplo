"use client";

import type { ReactNode } from "react";

import { trpc } from "@/lib/trpc";
import { SpinnerDots } from "@/components/ui";
import { LandingPage } from "@/components/landing/LandingPage";

/**
 * Top-level auth gate (`FR-AUTH-002`, `AC-P0-01`). No session → the public marketing
 * landing page (`INT-UI-002`). Session → the app, wrapped in `PresentationShell` by
 * `providers.tsx` (logout lives in the screen header there). The Silpo token never
 * reaches the client — only an httpOnly `navar_sid` session cookie.
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
    return <LandingPage onLogin={() => startLogin.mutate()} />;
  }

  return <>{children}</>;
}
