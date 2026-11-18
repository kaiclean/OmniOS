/**
 * Goals, KPIs, tasks and the personal ledger.
 *
 * Personal money is kept apart from every company's.
 */

import {
  money,
  type FinanceEntry,
  type Goal,
  type HealthDay,
  type Kpi,
  type Task,
} from '@/lib/domain';
import { round, series, type Rng } from '../rng';
import { addDays, base, dayOnly } from './shared';

/* --------------------------------------------------- the rest of a life --- */

export function makeGoals(rng: Rng, now: Date): Goal[] {
  const seeds: ReadonlyArray<[string, Goal['horizon'], string, string]> = [
    ['Seven hours of sleep on 6 of 7 nights', 'quarter', 'health', 'Everything else is downstream of this.'],
    ['Twelve months of personal runway, held separately', 'year', 'finance', 'So no company decision is ever made from fear.'],
    ['Deadlift bodyweight × 1.5 clean', 'year', 'health', 'A concrete proxy for staying strong.'],
    ['Speak French well enough for a client meeting', 'three-year', 'learning', 'Opens a market and a country.'],
    ['One full day a week, permanently offline', 'quarter', 'life-ops', 'The recovery the rest of the week borrows against.'],
  ];
  return seeds.map(([title, horizon, capabilityId, why], i) => ({
    ...base('goal', `${i}:${title}`, now),
    title,
    description: '',
    horizon,
    status: (rng.bool(0.7) ? 'on-track' : 'at-risk') as Goal['status'],
    progress: round(rng.float(0.1, 0.8), 2),
    targetDate: dayOnly(addDays(now, horizon === 'quarter' ? 90 : horizon === 'year' ? 365 : 1095)),
    capabilityId,
    why,
  }));
}

export function makeKpis(rng: Rng, now: Date, health: readonly HealthDay[]): Kpi[] {
  const recent = health.slice(-28).filter((d) => d.sleepHours !== undefined);
  const avgSleep = recent.length
    ? round(recent.reduce((s, d) => s + (d.sleepHours ?? 0), 0) / recent.length, 1)
    : 0;
  const energyValues = health.slice(-28).map((d) => d.energy).filter((e): e is number => typeof e === 'number');
  const avgEnergy = energyValues.length
    ? Math.round(energyValues.reduce((s, e) => s + e, 0) / energyValues.length)
    : 0;

  const seeds: ReadonlyArray<[string, string, Kpi['format'], Kpi['direction'], number, number | undefined]> = [
    ['Average sleep', 'health', 'number', 'up-good', avgSleep, 7],
    ['Average energy', 'health', 'score', 'up-good', avgEnergy, 70],
    ['Training sessions / week', 'health', 'number', 'up-good', round(rng.float(1.8, 4.2), 1), 3],
    ['Deep work hours / week', 'life-ops', 'number', 'up-good', round(rng.float(6, 19), 1), 15],
    ['Personal runway', 'finance', 'number', 'up-good', round(rng.float(4, 15), 1), 12],
    ['Monthly personal burn', 'finance', 'money', 'down-good', rng.int(3_800, 7_400), undefined],
    ['People overdue a call', 'relationships', 'number', 'down-good', rng.int(0, 4), 0],
    ['Open life admin', 'life-ops', 'number', 'down-good', rng.int(3, 11), 4],
  ];

  return seeds.map(([label, capabilityId, format, direction, value, target], i) => ({
    ...base('kpi', `${i}:${label}`, now),
    label,
    value,
    previousValue: round(value * rng.float(0.85, 1.15), 1),
    ...(target === undefined ? {} : { target }),
    format,
    currency: 'CHF' as const,
    direction,
    capabilityId,
    series: series(rng, value, 12, 0.1),
    period: 'Last 12 weeks',
  }));
}

export function makeTasks(rng: Rng, now: Date): Task[] {
  const seeds: ReadonlyArray<[string, string, Task['priority'], Task['energy'], number]> = [
    ['Call Mum', 'relationships', 'p1', 'light', 20],
    ['Book the physio follow-up', 'life-ops', 'p2', 'light', 10],
    ['Move the personal runway into the separate account', 'finance', 'p1', 'light', 25],
    ['Finish chapter 4 and write the note', 'learning', 'p2', 'moderate', 45],
    ['Plan next training block', 'health', 'p2', 'moderate', 30],
    ['Sort the document archive', 'life-ops', 'p3', 'light', 60],
    ['Write down what actually drained this week', 'health', 'p2', 'moderate', 20],
    ['Reply to Priya', 'relationships', 'p1', 'light', 15],
  ];
  return seeds.map(([title, capabilityId, priority, energy, estimateMinutes], i) => {
    const roll = rng.next();
    return {
      ...base('task', `${i}:${title}`, now),
      title,
      status: (roll < 0.2 ? 'done' : roll < 0.42 ? 'next' : 'backlog') as Task['status'],
      priority,
      capabilityId,
      energy,
      estimateMinutes,
      dueDate: dayOnly(addDays(now, rng.int(1, 21))),
      source: 'seed' as const,
    };
  });
}

export function makeFinance(rng: Rng, now: Date): FinanceEntry[] {
  const entries: FinanceEntry[] = [];
  const costs: ReadonlyArray<[string, number, number, boolean]> = [
    ['Rent', 1_650, 1_650, true],
    ['Health insurance', 420, 420, true],
    ['Groceries', 480, 760, false],
    ['Transport', 90, 260, false],
    ['Training & gym', 120, 120, true],
    ['Subscriptions', 60, 180, true],
    ['Travel', 0, 900, false],
    ['Books & courses', 0, 220, false],
  ];
  for (let monthsAgo = 8; monthsAgo >= -3; monthsAgo -= 1) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 3));
    const confidence: FinanceEntry['confidence'] =
      monthsAgo < 0 ? 'forecast' : monthsAgo === 0 ? 'committed' : 'actual';
    entries.push({
      ...base('fin', `in:${monthsAgo}`, now),
      date: dayOnly(monthDate),
      direction: 'in',
      amount: money(rng.int(7_500, 12_000) * 100, 'CHF'),
      category: 'Founder draw',
      label: 'Monthly draw',
      confidence,
      recurring: true,
      simulated: true,
    });
    for (const [category, lo, hi, recurring] of costs) {
      if (hi === 0) continue;
      entries.push({
        ...base('fin', `out:${monthsAgo}:${category}`, now),
        date: dayOnly(addDays(monthDate, 2)),
        direction: 'out',
        amount: money(rng.int(lo, hi) * 100, 'CHF'),
        category,
        label: category,
        confidence,
        recurring,
        simulated: true,
      });
    }
  }
  return entries;
}
