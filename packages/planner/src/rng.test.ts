import { describe, expect, it } from "vitest";

import { mulberry32, shuffle } from "./rng.js";

describe("mulberry32", () => {
  it("is a pure function of the seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("diverges for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });
});

describe("shuffle", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];

  it("is deterministic for a given seed and leaves the input untouched", () => {
    const s1 = shuffle(xs, mulberry32(7));
    const s2 = shuffle(xs, mulberry32(7));
    expect(s1).toEqual(s2);
    expect(xs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...s1].sort((a, b) => a - b)).toEqual(xs);
  });

  it("usually reorders, and differs by seed", () => {
    expect(shuffle(xs, mulberry32(1))).not.toEqual(shuffle(xs, mulberry32(2)));
  });
});
