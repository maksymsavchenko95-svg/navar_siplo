import type { McpToolSummary } from "@navar/domain";

/** Trim a raw MCP `tools/list` payload to what the UI needs, sorted by name. */
export function toToolSummaries(tools: { name: string; description?: string }[]): McpToolSummary[] {
  return tools
    .map((t) => ({ name: t.name, description: t.description ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
