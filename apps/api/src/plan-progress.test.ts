import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = new Map<string, string>();
vi.mock("./queue/connection.js", () => ({
  connection: {
    get: async (k: string) => redis.get(k) ?? null,
    set: async (k: string, v: string) => void redis.set(k, v),
    del: async (k: string) => void redis.delete(k),
  },
}));

const { setGenStage, readGenStage, clearGenStage } = await import("./plan-progress.js");

beforeEach(() => redis.clear());

describe("plan-progress", () => {
  it("round-trips the current stage per household", async () => {
    expect(await readGenStage("hh-1")).toBeNull();

    await setGenStage("hh-1", "pricing");
    expect(await readGenStage("hh-1")).toBe("pricing");

    await setGenStage("hh-1", "solving");
    expect(await readGenStage("hh-1")).toBe("solving");

    // scoped per household
    expect(await readGenStage("hh-2")).toBeNull();

    await clearGenStage("hh-1");
    expect(await readGenStage("hh-1")).toBeNull();
  });

  it("is best-effort — a Redis failure never throws", async () => {
    const { connection } = await import("./queue/connection.js");
    vi.spyOn(connection, "get").mockRejectedValueOnce(new Error("redis down"));
    expect(await readGenStage("hh-1")).toBeNull();

    vi.spyOn(connection, "set").mockRejectedValueOnce(new Error("redis down"));
    await expect(setGenStage("hh-1", "context")).resolves.toBeUndefined();
  });
});
