import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The LLM SDK (`ai` / `@ai-sdk/*`) must be imported only under `src/anthropic/` — the
 * mirror of the `@modelcontextprotocol/sdk` boundary in `@navar/retail` (ADR-04 style).
 */
const SRC = fileURLToPath(new URL(".", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("LLM SDK boundary", () => {
  it("only src/anthropic imports `ai` / `@ai-sdk/*`", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.includes("/anthropic/") && !f.endsWith(".test.ts"))
      .filter((f) => /from\s+["'](ai|@ai-sdk\/[^"']+)["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
