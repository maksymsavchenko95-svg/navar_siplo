"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState, type ReactNode } from "react";

import { PresentationShell } from "@/components/PresentationShell";
import { SessionGate } from "@/components/SessionGate";
import { apiUrl, trpc } from "@/lib/trpc";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${apiUrl}/trpc`,
          // Carry the httpOnly session cookie on every call (FR-AUTH-002).
          fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SessionGate>
          <PresentationShell>{children}</PresentationShell>
        </SessionGate>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
