/**
 * Energy derivation.
 *
 * The Executive Assistant plans a founder's week against available energy, so
 * this number has to be honest. It is computed only from inputs that are actually
 * present; when there is not enough to say anything, it returns `null` and the UI
 * shows a dash. An invented energy score would be worse than no score at all,
 * because the whole system would plan against it.
 */

import type { HealthDay } from '@/lib/domain';

export interface EnergyBreakdown {
  /** 0..100, or null when there is not enough input to say. */
  readonly score: number | null;
  readonly contributions: ReadonlyArray<{ label: string; points: number; of: number }>;
  readonly missing: readonly string[];
}

interface Band {
  readonly label: string;
  readonly weight: number;
  readonly read: (day: HealthDay) => number | undefined;
  /** Maps a raw reading to 0..1. */
  readonly normalise: (value: number) => number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const BANDS: readonly Band[] = [
  {
    label: 'Sleep duration',
    weight: 30,
    read: (d) => d.sleepHours,
    // 7.5h is the top of the band; below 5h contributes nothing.
    normalise: (h) => clamp01((h - 5) / 2.5),
  },
  {
    label: 'Sleep quality',
    weight: 15,
    read: (d) => d.sleepQuality,
    normalise: (q) => clamp01(q / 100),
  },
  {
    label: 'Recovery (HRV)',
    weight: 25,
    read: (d) => d.hrv,
    normalise: (hrv) => clamp01((hrv - 25) / 65),
  },
  {
    label: 'Stress load',
    weight: 20,
    read: (d) => d.stress,
    normalise: (s) => clamp01(1 - s / 100),
  },
  {
    label: 'Movement',
    weight: 10,
    read: (d) => d.workoutMinutes,
    // Some movement helps; three hours of training is a cost, not a credit.
    normalise: (m) => clamp01(m / 45) * (m > 150 ? 0.6 : 1),
  },
];

/** At least this share of the weighting must be present before a score is offered. */
const MINIMUM_COVERAGE = 0.5;

export function deriveEnergy(day: HealthDay): EnergyBreakdown {
  const contributions: Array<{ label: string; points: number; of: number }> = [];
  const missing: string[] = [];
  let earned = 0;
  let available = 0;

  for (const band of BANDS) {
    const raw = band.read(day);
    if (raw === undefined || Number.isNaN(raw)) {
      missing.push(band.label);
      continue;
    }
    const points = band.normalise(raw) * band.weight;
    earned += points;
    available += band.weight;
    contributions.push({ label: band.label, points: Math.round(points), of: band.weight });
  }

  const totalWeight = BANDS.reduce((sum, b) => sum + b.weight, 0);
  if (available / totalWeight < MINIMUM_COVERAGE) {
    return { score: null, contributions, missing };
  }
  return {
    score: Math.round((earned / available) * 100),
    contributions,
    missing,
  };
}

/** The stored value if present, otherwise derived. Never invented. */
export function energyOf(day: HealthDay | undefined): number | null {
  if (!day) return null;
  if (typeof day.energy === 'number') return day.energy;
  return deriveEnergy(day).score;
}

export function energyLabel(score: number | null): string {
  if (score === null) return 'Not enough data';
  if (score >= 78) return 'High';
  if (score >= 60) return 'Steady';
  if (score >= 42) return 'Low';
  return 'Depleted';
}

/**
 * How much deep work a day at this energy can honestly carry, in minutes.
 * Used by the assistant when it balances a week rather than just listing tasks.
 */
export function deepWorkBudgetMinutes(score: number | null): number | null {
  if (score === null) return null;
  if (score >= 78) return 300;
  if (score >= 60) return 210;
  if (score >= 42) return 120;
  return 45;
}
