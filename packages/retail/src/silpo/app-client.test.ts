import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CredentialStore, StoredMcpTokens } from "@navar/domain";
import { describe, expect, it, vi } from "vitest";

import { type AppClientStore, resolveAppOAuthClient } from "./app-client.js";
import { SilpoOAuthProvider } from "./oauth.js";

const CLIENT = { client_id: "c-123", redirect_uris: ["http://x/cb"] } as OAuthClientInformationFull;

function memStore(
  initial?: OAuthClientInformationFull,
): AppClientStore & { value?: OAuthClientInformationFull } {
  const s: AppClientStore & { value?: OAuthClientInformationFull } = {
    value: initial,
    async get() {
      return this.value;
    },
    async set(c) {
      this.value = c;
    },
  };
  return s;
}

const base = { mcpUrl: "https://mcp.example/mcp", redirectUrl: "http://x/cb" };

describe("resolveAppOAuthClient — source precedence", () => {
  it("env pin wins, store + DCR untouched", async () => {
    const store = memStore();
    const register = vi.fn();
    const got = await resolveAppOAuthClient({
      ...base,
      store,
      envJson: JSON.stringify(CLIENT),
      register,
    });
    expect(got.client_id).toBe("c-123");
    expect(store.value).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it("store hit is returned without DCR", async () => {
    const register = vi.fn();
    const got = await resolveAppOAuthClient({ ...base, store: memStore(CLIENT), register });
    expect(got.client_id).toBe("c-123");
    expect(register).not.toHaveBeenCalled();
  });

  it("cold start: DCR runs once, result cached", async () => {
    const store = memStore();
    const register = vi.fn(async () => CLIENT);
    await resolveAppOAuthClient({ ...base, store, register });
    await resolveAppOAuthClient({ ...base, store, register }); // 2nd call hits the cache
    expect(register).toHaveBeenCalledTimes(1);
    expect(store.value?.client_id).toBe("c-123");
  });
});

describe("SilpoOAuthProvider — shared client mode", () => {
  const credStore: CredentialStore = {
    load: vi.fn(async () => ({ expiresAt: 0 }) as StoredMcpTokens),
    save: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };

  it("returns the shared client and never persists it per household", async () => {
    const p = new SilpoOAuthProvider({
      store: credStore,
      householdId: "hh-1",
      redirectUrl: "http://x/cb",
      appClientInformation: async () => CLIENT,
    });
    expect((await p.clientInformation())?.client_id).toBe("c-123");
    await p.saveClientInformation(CLIENT);
    expect(credStore.save).not.toHaveBeenCalled();
  });
});
