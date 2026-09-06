import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateObject = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
  NoObjectGeneratedError: class NoObjectGeneratedError extends Error {
    static isInstance(e: unknown): e is Error {
      return e instanceof Error && e.name === "NoObjectGeneratedError";
    }
  },
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (model: string) => ({ model }),
}));

const { AnthropicLlmProvider } = await import("./adapter.js");
const { LlmSchemaError } = await import("../provider.js");

const schema = z.object({ text: z.string() });
const baseReq = { schemaName: "s", schema, system: "sys", prompt: "p", temperature: 0 };

beforeEach(() => {
  generateObject.mockReset();
  generateObject.mockResolvedValue({
    object: { text: "hi" },
    usage: { inputTokens: 10, outputTokens: 4 },
  });
});

describe("AnthropicLlmProvider", () => {
  it("omits temperature for claude-sonnet-5 (the API rejects it)", async () => {
    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-sonnet-5" });
    await provider.generateObject(baseReq);
    expect(generateObject.mock.calls[0]![0]).not.toHaveProperty("temperature");
  });

  it("forwards temperature:0 for a model that still accepts sampling params", async () => {
    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-haiku-4-5" });
    await provider.generateObject(baseReq);
    expect(generateObject.mock.calls[0]![0]).toMatchObject({ temperature: 0 });
  });

  it("passes the Zod schema and schemaName through unchanged", async () => {
    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-sonnet-5" });
    await provider.generateObject(baseReq);
    expect(generateObject.mock.calls[0]![0]).toMatchObject({ schema, schemaName: "s" });
  });

  it("returns the object plus usage and model", async () => {
    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-sonnet-5" });
    const res = await provider.generateObject(baseReq);
    expect(res).toEqual({
      value: { text: "hi" },
      usage: { inputTokens: 10, outputTokens: 4 },
      model: "claude-sonnet-5",
    });
  });

  it("retries once on an overloaded_error then succeeds (withBackoff)", async () => {
    vi.useFakeTimers();
    const overloaded = Object.assign(new Error("overloaded_error"), { statusCode: 429 });
    generateObject.mockRejectedValueOnce(overloaded).mockResolvedValueOnce({
      object: { text: "ok" },
      usage: {},
    });

    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-sonnet-5" });
    const p = provider.generateObject(baseReq);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(res.value).toEqual({ text: "ok" });
    vi.useRealTimers();
  });

  it("does not retry a 401 (invalid key) — surfaces it on the first attempt", async () => {
    const unauthorized = Object.assign(new Error("API key is invalid"), {
      name: "APICallError",
      statusCode: 401,
    });
    generateObject.mockRejectedValue(unauthorized);
    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-sonnet-5" });
    await expect(provider.generateObject(baseReq)).rejects.toBe(unauthorized);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 400 billing error either", async () => {
    const billing = Object.assign(new Error("Your credit balance is too low"), {
      name: "APICallError",
      statusCode: 400,
    });
    generateObject.mockRejectedValue(billing);
    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-sonnet-5" });
    await expect(provider.generateObject(baseReq)).rejects.toBe(billing);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("maps a NoObjectGeneratedError to LlmSchemaError", async () => {
    const err = Object.assign(new Error("no object"), { name: "NoObjectGeneratedError" });
    generateObject.mockRejectedValue(err);
    const provider = new AnthropicLlmProvider({ apiKey: "k", model: "claude-sonnet-5" });
    await expect(provider.generateObject(baseReq)).rejects.toBeInstanceOf(LlmSchemaError);
  });
});
