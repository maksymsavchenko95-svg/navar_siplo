import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./concurrency.js";

const deferred = () => {
  let resolve!: (v: void) => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const out = await mapWithConcurrency([10, 20, 30, 40], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n === 20 ? 0 : 5)); // 20 finishes first
      return n * 2;
    });
    expect(out).toEqual([20, 40, 60, 80]);
  });

  it("never runs more than `limit` at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const gate = deferred();
    const run = mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        if (i < 4) await gate.promise; // hold the first wave open
        inFlight--;
        return i;
      },
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(peak).toBe(4);
    gate.resolve();
    expect(await run).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(peak).toBe(4);
  });

  it("clamps the width to the item count and handles an empty list", async () => {
    expect(await mapWithConcurrency([], 8, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1], 8, async (n) => n + 1)).toEqual([2]);
  });

  it("propagates a rejection (Promise.all semantics)", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
