"use client";

import { trpc } from "@/lib/trpc";

export function McpStatus() {
  const tools = trpc.mcp.listTools.useQuery();
  return (
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
  );
}
