// Shared deterministic PRNG — the canonical randomness contract for both the
// TypeScript engine and the Python reference engine (see
// docs/rules-parity-contract.md). Mulberry32 is a small, fully specified 32-bit
// generator that is trivial to reimplement identically in any language; the
// Python engine mirrors it byte-for-byte in assalto_pygbag_ready/assalto_prng.py.
// Sharing it is what makes seeded Special/Transform Square generation
// reproducible across runtimes (and, in future, an authoritative server).
//
// Contract:
//   - seed is coerced to an unsigned 32-bit integer.
//   - next() returns a float in [0, 1) as (state_u32 / 2^32).
//   - randomInt(bound) = floor(next() * bound), one draw.
//   - shuffle is Fisher-Yates from the last index down, drawing one value per
//     step: j = randomInt(i + 1).
//   - choice(seq) = seq[randomInt(seq.length)], one draw.

export type Rng = () => number;

/** Mulberry32. `seed` is coerced to an unsigned 32-bit integer. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, bound) using a single draw. `bound` must be > 0. */
export function randomInt(rng: Rng, bound: number): number {
  return Math.floor(rng() * bound);
}

/** Fisher-Yates shuffle using `rng`; returns a new array (input untouched). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(rng, index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

/** Pick one element with a single draw; returns undefined for empty input. */
export function choice<T>(items: readonly T[], rng: Rng): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items[randomInt(rng, items.length)];
}
