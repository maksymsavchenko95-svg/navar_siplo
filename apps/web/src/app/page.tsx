"use client";

import { trpc } from "@/lib/trpc";

export default function HomePage() {
  const hello = trpc.hello.useQuery({ name: "Navar" });
  const recipes = trpc.recipes.list.useQuery();
  const tools = trpc.mcp.listTools.useQuery();

  return (
    <main>
      <h1>Navar</h1>

      <section>
        <h2>API</h2>
        <p>{hello.data ? hello.data.message : hello.isLoading ? "…" : "API unreachable"}</p>
      </section>

      <section>
        <h2>Recipes (Postgres)</h2>
        {recipes.data?.length ? (
          <ul>
            {recipes.data.map((r) => (
              <li key={r.id}>
                <strong>{r.title}</strong> — {r.servings} port., {r.totalMinutes} min ·{" "}
                {r.ingredients.join(", ")}
                {r.tags.length > 0 && <em> [{r.tags.join(", ")}]</em>}
              </li>
            ))}
          </ul>
        ) : (
          <p>{recipes.isLoading ? "…" : "No recipes — run `pnpm db:seed`."}</p>
        )}
      </section>

      <section>
        <h2>Silpo MCP</h2>
        {tools.data?.status === "ok" ? (
          <p>
            {tools.data.tools.length} tools available via <code>tools/list</code>.
          </p>
        ) : tools.data?.status === "auth_required" ? (
          <p>Not connected — {tools.data.hint}.</p>
        ) : (
          <p>{tools.isLoading ? "…" : "MCP unreachable"}</p>
        )}
      </section>
    </main>
  );
}
