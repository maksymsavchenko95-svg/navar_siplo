"use client";

import type { ReactNode } from "react";

import { trpc } from "@/lib/trpc";

/**
 * Auth gate (`FR-AUTH-002`). No session → a login screen with «Ввійти з Сільпо». Session →
 * the app plus a header with «Вийти». The Silpo token never reaches the client — only an
 * httpOnly session cookie.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = trpc.auth.status.useQuery();
  const utils = trpc.useUtils();

  const startLogin = trpc.auth.startLogin.useMutation({
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void utils.invalidate();
      window.location.reload();
    },
  });

  if (status.isLoading) return <p>…</p>;

  if (!status.data?.connected) {
    return (
      <div style={{ display: "grid", gap: 16, placeItems: "center", padding: "4rem 0" }}>
        <h1>Navar</h1>
        <p style={{ color: "#555", textAlign: "center", maxWidth: 360 }}>
          Тижневий продуктовий план на базі ваших покупок у «Сільпо».
        </p>
        <button
          onClick={() => startLogin.mutate()}
          disabled={startLogin.isPending}
          style={{
            padding: "0.7rem 1.4rem",
            fontSize: "1rem",
            borderRadius: 10,
            border: "none",
            background: "#e8590c",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {startLogin.isPending ? "…" : "Ввійти з Сільпо"}
        </button>
        {startLogin.isError && (
          <p style={{ color: "#c92a2a" }}>Не вдалося почати вхід. Спробуйте ще раз.</p>
        )}
      </div>
    );
  }

  return (
    <>
      <header
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          style={{
            padding: "0.35rem 0.8rem",
            borderRadius: 8,
            border: "1px solid #ccc",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Вийти
        </button>
      </header>
      {children}
    </>
  );
}
