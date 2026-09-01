import { afterEach, describe, expect, it, vi } from "vitest";

// Don't let a real repo-root .env repopulate what the tests delete.
vi.mock("node:fs", () => ({ existsSync: () => false }));

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe("llmEnv", () => {
  it("parses when ANTHROPIC_API_KEY is unset and defaults the model", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NAVAR_LLM_MODEL;
    vi.resetModules();

    const { llmEnv } = await import("./env.js");

    expect(llmEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(llmEnv.NAVAR_LLM_MODEL).toBe("claude-sonnet-5");
  });

  it("treats an empty ANTHROPIC_API_KEY as absent (copied .env.example)", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    vi.resetModules();

    const { llmEnv } = await import("./env.js");

    expect(llmEnv.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
