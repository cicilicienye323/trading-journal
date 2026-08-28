/**
 * Seeded pseudo-random numbers.
 *
 * Demo and test data must be reproducible: `Math.random()` would give a
 * different fixture on every run, which makes tests flaky and makes "the
 * screenshot doesn't match the seed data" impossible to debug. Same seed in,
 * same numbers out, forever.
 *
 * mulberry32 — small, fast, good enough for generating plausible-looking data.
 * Not cryptographically secure; never use it for tokens or IDs.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal sample via the Box-Muller transform. Price returns are
 * modelled as normally distributed, so a uniform RNG alone would produce
 * visibly wrong-looking series (no fat middle, hard cutoffs at the edges).
 */
export function normal(rng: () => number): number {
  // u must be non-zero: Math.log(0) is -Infinity.
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Random integer in [min, max] inclusive. */
export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Picks one element. Throws on an empty array rather than returning undefined. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("pick() called with an empty array");
  }
  return items[Math.floor(rng() * items.length)]!;
}
