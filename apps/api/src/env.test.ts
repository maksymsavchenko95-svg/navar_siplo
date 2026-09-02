import { afterEach, describe, expect, it, vi } from "vitest";

// Don't let a real repo-root / apps/api .env repopulate what the tests delete.
vi.mock("node:fs", () => ({ existsSync: () => false }));

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe("env", () => {
  it("an empty COOKIE_SECRET (copied .env.example / `${COOKIE_SECRET:-}` in compose) falls back to the default", async () => {
    // z.string().min(16) would reject "" — the API used to crash-loop on boot here.
    process.env.COOKIE_SECRET = "";
    vi.resetModules();

    const { env } = await import("./env.js");

    expect(env.COOKIE_SECRET).toBe("dev-insecure-cookie-secret-change-me");
  });

  it("empty PUBLIC_API_URL / WEB_ORIGIN fall back to the localhost defaults", async () => {
    process.env.PUBLIC_API_URL = "";
    process.env.WEB_ORIGIN = "";
    vi.resetModules();

    const { env } = await import("./env.js");

    expect(env.PUBLIC_API_URL).toBe("http://localhost:3001");
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("empty SESSION_TTL_S falls back to 30 days", async () => {
    process.env.SESSION_TTL_S = "";
    vi.resetModules();

    const { env } = await import("./env.js");

    expect(env.SESSION_TTL_S).toBe(60 * 60 * 24 * 30);
  });

  it("a real COOKIE_SECRET is passed through unchanged", async () => {
    process.env.COOKIE_SECRET = "a-genuinely-set-cookie-secret-value";
    vi.resetModules();

    const { env } = await import("./env.js");

    expect(env.COOKIE_SECRET).toBe("a-genuinely-set-cookie-secret-value");
  });
});
