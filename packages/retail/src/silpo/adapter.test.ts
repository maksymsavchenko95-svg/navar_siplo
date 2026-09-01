import { describe, expect, it, vi } from "vitest";

import { AuthRequiredError } from "../provider.js";
import { SilpoRetailProvider } from "./adapter.js";

/** A provider with a stubbed MCP client so `connect()` short-circuits (no network). */
function providerWith(clientCallTool: (args: { name: string; arguments: unknown }) => unknown) {
  const provider = new SilpoRetailProvider({
    mcpUrl: "https://mcp.example/mcp",
    store: { load: async () => undefined, save: async () => {}, clear: async () => {} } as never,
    householdId: "hh-1",
    redirectUrl: "http://localhost:0/callback",
  });
  (provider as unknown as { client: unknown }).client = { callTool: vi.fn(clientCallTool) };
  return provider;
}

describe("SilpoRetailProvider.callToolRaw", () => {
  it("forwards name + args to the client and returns the parsed JSON payload", async () => {
    const spy = vi.fn(() => ({ content: [{ type: "text", text: '{"orders":[1,2,3]}' }] }));
    const provider = providerWith(spy);

    const out = await provider.callToolRaw("silpo_get_my_offline_orders", { limit: 10, offset: 0 });

    expect(out).toEqual({ orders: [1, 2, 3] });
    expect(spy).toHaveBeenCalledWith({
      name: "silpo_get_my_offline_orders",
      arguments: { limit: 10, offset: 0 },
    });
  });

  it("defaults args to an empty object", async () => {
    const spy = vi.fn(() => ({ content: [{ type: "text", text: "{}" }] }));
    await providerWith(spy).callToolRaw("silpo_get_loyalty_info");
    expect(spy).toHaveBeenCalledWith({ name: "silpo_get_loyalty_info", arguments: {} });
  });

  it("throws when the tool result is an error", async () => {
    const provider = providerWith(() => ({
      isError: true,
      content: [{ type: "text", text: '{"_raw":"Rate limit exceeded"}' }],
    }));
    await expect(provider.callToolRaw("silpo_add_or_update_cart_products")).rejects.toThrow(
      /Rate limit exceeded/,
    );
  });

  it("maps an SDK UnauthorizedError to AuthRequiredError", async () => {
    const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const provider = providerWith(() => {
      throw new UnauthorizedError("nope");
    });
    await expect(provider.callToolRaw("silpo_get_my_profile")).rejects.toBeInstanceOf(
      AuthRequiredError,
    );
  });
});
