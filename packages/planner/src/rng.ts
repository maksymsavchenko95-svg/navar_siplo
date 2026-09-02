/**
 * The one seeded RNG in the repo (ADR-03 — "будь-яка випадковість — лише через seeded
 * RNG"). `mulberry32` is a tiny, well-known 32-bit generator: fast, no dependencies,
 * fully reproducible from an integer seed. Used to break score ties in a seed-dependent
 * (but deterministic) way so different seeds yield different valid plans; T3.3's local
 * search reuses it.
 */

export type Rng = () => number;

/** mulberry32 — returns a function producing floats in [0, 1). Same seed → same sequence. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle — pure (returns a new array), deterministic given `rng`. */
export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
