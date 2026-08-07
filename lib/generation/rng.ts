/**
 * Deterministic pseudo-randomness.
 *
 * Everything OmniOS generates — a company headquarters, a week of sample health
 * data, a delegation plan — is derived from a seed rather than `Math.random()`.
 * Two consequences matter: the same company always looks the same across reloads
 * and machines, and generation is testable with plain equality assertions.
 */

import { hash32 } from '@/lib/domain/ids';

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  bool(probability?: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** `count` distinct items, or all of them when the list is shorter. */
  sample<T>(items: readonly T[], count: number): T[];
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32 — small, fast, good enough for content generation. */
export function createRng(seed: string | number): Rng {
  let state = (typeof seed === 'number' ? seed : hash32(seed)) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) return min;
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('createRng().pick called with an empty list');
    return items[int(0, items.length - 1)] as T;
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const a = out[i] as T;
      const b = out[j] as T;
      out[i] = b;
      out[j] = a;
    }
    return out;
  };

  return {
    next,
    int,
    float: (min, max) => min + next() * (max - min),
    bool: (probability = 0.5) => next() < probability,
    pick,
    sample: (items, count) => shuffle(items).slice(0, Math.max(0, Math.min(count, items.length))),
    shuffle,
  };
}

/** Rounds to a given number of decimals — generated numbers should look authored. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * A plausible metric series ending at `end`, with gentle drift and noise.
 * Used for the hairline rails under metric tiles — never presented as measured data.
 */
export function series(rng: Rng, end: number, points: number, volatility = 0.12): number[] {
  const out: number[] = new Array(points);
  let value = end;
  out[points - 1] = round(end, 2);
  for (let i = points - 2; i >= 0; i -= 1) {
    const drift = 1 - rng.float(-volatility, volatility * 1.35);
    value = Math.max(0, value * drift);
    out[i] = round(value, 2);
  }
  return out;
}
