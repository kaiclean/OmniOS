import { describe, expect, it } from 'vitest';

import { deepWorkBudgetMinutes, deriveEnergy, energyLabel, energyOf } from '@/lib/personal/energy';
import type { HealthDay } from '@/lib/domain';

const day = (patch: Partial<HealthDay>): HealthDay => ({
  id: 'h1',
  scope: { kind: 'personal' },
  createdAt: '2026-03-14T00:00:00.000Z',
  updatedAt: '2026-03-14T00:00:00.000Z',
  date: '2026-03-14',
  ...patch,
});

describe('energy derivation', () => {
  it('refuses to score a day with no inputs', () => {
    expect(deriveEnergy(day({})).score).toBeNull();
  });

  it('refuses to score a day below the coverage threshold', () => {
    // Movement alone is 10 of 100 weight — far below the 50% required.
    expect(deriveEnergy(day({ workoutMinutes: 45 })).score).toBeNull();
  });

  it('scores a day once enough of the weighting is present', () => {
    const result = deriveEnergy(day({ sleepHours: 8, hrv: 70, stress: 20 }));
    expect(result.score).not.toBeNull();
    expect(result.score).toBeGreaterThan(70);
  });

  it('rates a well-recovered day above a depleted one', () => {
    const good = deriveEnergy(day({ sleepHours: 8.2, sleepQuality: 92, hrv: 78, stress: 15 })).score;
    const bad = deriveEnergy(day({ sleepHours: 4.9, sleepQuality: 30, hrv: 28, stress: 85 })).score;
    expect(good).not.toBeNull();
    expect(bad).not.toBeNull();
    expect(good as number).toBeGreaterThan(bad as number);
  });

  it('keeps the score inside 0..100', () => {
    const extremeHigh = deriveEnergy(
      day({ sleepHours: 14, sleepQuality: 100, hrv: 200, stress: 0, workoutMinutes: 60 }),
    ).score;
    const extremeLow = deriveEnergy(
      day({ sleepHours: 0, sleepQuality: 0, hrv: 0, stress: 100, workoutMinutes: 0 }),
    ).score;
    expect(extremeHigh).toBeLessThanOrEqual(100);
    expect(extremeLow).toBeGreaterThanOrEqual(0);
  });

  it('treats an enormous training load as a cost, not a credit', () => {
    const moderate = deriveEnergy(day({ sleepHours: 7, hrv: 60, stress: 40, workoutMinutes: 45 })).score;
    const excessive = deriveEnergy(day({ sleepHours: 7, hrv: 60, stress: 40, workoutMinutes: 240 })).score;
    expect(excessive as number).toBeLessThan(moderate as number);
  });

  it('reports which inputs were missing', () => {
    const result = deriveEnergy(day({ sleepHours: 7, hrv: 60, stress: 30 }));
    expect(result.missing).toContain('Sleep quality');
    expect(result.missing).toContain('Movement');
  });

  it('prefers a stored energy value over re-deriving it', () => {
    expect(energyOf(day({ energy: 42, sleepHours: 8, hrv: 80, stress: 10 }))).toBe(42);
  });

  it('returns null for an absent day rather than zero', () => {
    expect(energyOf(undefined)).toBeNull();
  });
});

describe('energy labels and budgets', () => {
  it('says so plainly when there is not enough data', () => {
    expect(energyLabel(null)).toBe('Not enough data');
    expect(deepWorkBudgetMinutes(null)).toBeNull();
  });

  it('never promises more deep work at lower energy', () => {
    const scores = [95, 78, 70, 60, 50, 42, 20, 0];
    const budgets = scores.map((s) => deepWorkBudgetMinutes(s) as number);
    for (let i = 1; i < budgets.length; i += 1) {
      expect(budgets[i] as number).toBeLessThanOrEqual(budgets[i - 1] as number);
    }
  });

  it('labels the bands in descending order', () => {
    expect(energyLabel(90)).toBe('High');
    expect(energyLabel(65)).toBe('Steady');
    expect(energyLabel(50)).toBe('Low');
    expect(energyLabel(20)).toBe('Depleted');
  });
});
