"use client";

import { trpc } from "@/lib/trpc";

/**
 * Starts the Silpo OAuth flow from anywhere inside the app — used by the `auth_required`
 * reconnect banner on protected screens. Mirrors `SessionGate`'s login mutation.
 */
export function useReconnect(): () => void {
  const startLogin = trpc.auth.startLogin.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
  });
  return () => startLogin.mutate();
}
