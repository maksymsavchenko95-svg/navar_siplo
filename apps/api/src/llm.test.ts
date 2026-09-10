import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `checkLlmHealth` — the startup probe must be loud and never throw. The provider is
 * injected, so no test touches the network; `ANTHROPIC_API_KEY` is set/unset per test with
 * `vi.resetModules()` because `@navar/llm`'s `llmEnv` is parsed at import time.
 */
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: () => false, // keep the real .env out of process.env; prompts still load
}));

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
  vi.resetModules();
});

async function load(key: string | undefined) {
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  process.env.NAVAR_LLM_MODEL = "claude-test";
  vi.resetModules();
  return import("./llm.js");
}

describe("checkLlmHealth", () => {
  it("starts as checking until the probe has run", async () => {
    const { getLlmHealth } = await load("sk-ant-test");
    expect(getLlmHealth().status).toBe("checking");
  });

  it("reports ok when the provider answers", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { checkLlmHealth, getLlmHealth } = await load("sk-ant-test");
    const provider = { generateObject: vi.fn(async () => ({ value: { ok: true }, model: "m" })) };

    const h = await checkLlmHealth(provider as never);

    expect(h).toEqual({ status: "ok", model: "claude-test", rerankModel: "claude-haiku-4-5" });
    expect(getLlmHealth()).toEqual(h);
    expect(provider.generateObject).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[llm] ok — model claude-test"));
  });

  it("reports degraded (and warns) when the key is rejected — never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkLlmHealth, getLlmHealth } = await load("sk-ant-bad");
    const provider = {
      generateObject: vi.fn(async () => {
        throw Object.assign(new Error("API key is invalid"), { statusCode: 401 });
      }),
    };

    const h = await checkLlmHealth(provider as never);

    expect(h.status).toBe("degraded");
    expect(h.message).toContain("API key is invalid");
    expect(getLlmHealth().status).toBe("degraded");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[llm] DEGRADED — API key is invalid"),
    );
  });

  it("reports disabled without calling the provider when there is no key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkLlmHealth } = await load(undefined);
    const provider = { generateObject: vi.fn() };

    const h = await checkLlmHealth(provider as never);

    expect(h).toEqual({
      status: "disabled",
      model: "claude-test",
      rerankModel: "claude-haiku-4-5",
    });
    expect(provider.generateObject).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[llm] DISABLED"));
  });
});
