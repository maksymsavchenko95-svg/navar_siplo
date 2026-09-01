"use client";

import { trpc } from "@/lib/trpc";

export function HelloCard() {
  const hello = trpc.hello.useQuery({ name: "Navar" });
  return (
    <section>
      <h2>API</h2>
      <p>{hello.data ? hello.data.message : hello.isLoading ? "…" : "API unreachable"}</p>
    </section>
  );
}
