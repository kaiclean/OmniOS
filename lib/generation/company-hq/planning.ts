/**
 * Goals, KPIs, tasks and roadmap.
 *
 * The founder's own goals are real records in every mode; the rest is seeded and
 * marked as such.
 */

import { money, type Goal, type Kpi, type RoadmapItem, type Task } from '@/lib/domain';
import { round, series } from '../rng';
import { addDays, base, dayOnly, iso, type GenCtx } from './shared';

/* ---------------------------------------------------------------- goals --- */

/** The goals the founder actually typed — real records in every mode, including a clean slate. */
export function founderGoals(ctx: GenCtx): Goal[] {
  const { draft, now } = ctx;
  return draft.goals.filter(Boolean).map((title, i) => ({
    ...base(ctx, 'goal', `founder:${i}:${title}`),
    title,
    description: 'Set during company creation.',
    horizon: (i === 0 ? 'quarter' : i === 1 ? 'year' : 'three-year') as Goal['horizon'],
    status: 'on-track' as const,
    progress: 0,
    targetDate: dayOnly(addDays(now, i === 0 ? 90 : i === 1 ? 365 : 1095)),
    capabilityId: 'strategy',
    why: 'Named by the founder as a reason this company exists right now.',
  }));
}

export function makeGoals(ctx: GenCtx): Goal[] {
  const { rng, now } = ctx;
  const explicit = founderGoals(ctx);

  const generated: Array<[string, string, Goal['horizon'], string]> = [
    [
      'Make the first ten deliveries repeatable',
      'operations',
      'quarter',
      'Repeatability is the difference between a job and a business.',
    ],
    [
      'One channel that reliably produces qualified conversations',
      'marketing',
      'quarter',
      'Referrals are a gift, not a plan.',
    ],
    [
      'Cover fixed costs from recurring revenue',
      'finance',
      'year',
      'Runway bought with recurring revenue is runway that compounds.',
    ],
    [
      'Operate without the founder in the critical path',
      'operations',
      'three-year',
      'Every process that needs one person is a single point of failure.',
    ],
  ];

  return [
    ...explicit,
    ...generated.map(([title, capabilityId, horizon, why], i) => ({
      ...base(ctx, 'goal', `gen:${i}:${title}`),
      title,
      description: '',
      horizon,
      status: (rng.bool(0.75) ? 'on-track' : 'at-risk') as Goal['status'],
      progress: round(rng.float(0.05, 0.45), 2),
      targetDate: dayOnly(addDays(now, horizon === 'quarter' ? 90 : horizon === 'year' ? 365 : 1095)),
      capabilityId,
      why,
    })),
  ];
}

/* ------------------------------------------------------------------ kpis -- */

interface KpiSeed {
  label: string;
  capabilityId: string;
  format: Kpi['format'];
  direction: Kpi['direction'];
  min: number;
  max: number;
  decimals?: number;
  target?: number;
}

export const KPI_SEEDS: readonly KpiSeed[] = [
  { label: 'Monthly revenue', capabilityId: 'finance', format: 'money', direction: 'up-good', min: 12_000, max: 68_000 },
  { label: 'Gross margin', capabilityId: 'finance', format: 'percent', direction: 'up-good', min: 32, max: 61, target: 55 },
  { label: 'Runway', capabilityId: 'finance', format: 'number', direction: 'up-good', min: 5, max: 19, target: 12 },
  { label: 'Qualified conversations', capabilityId: 'marketing', format: 'number', direction: 'up-good', min: 4, max: 34 },
  { label: 'Cost per conversation', capabilityId: 'marketing', format: 'money', direction: 'down-good', min: 40, max: 260 },
  { label: 'Pipeline value', capabilityId: 'sales', format: 'money', direction: 'up-good', min: 20_000, max: 240_000 },
  { label: 'Win rate', capabilityId: 'sales', format: 'percent', direction: 'up-good', min: 14, max: 48, target: 35 },
  { label: 'Cycle time', capabilityId: 'development', format: 'duration-minutes', direction: 'down-good', min: 1_800, max: 9_600 },
  { label: 'Shipped this month', capabilityId: 'development', format: 'number', direction: 'up-good', min: 1, max: 11 },
  { label: 'On-time delivery', capabilityId: 'operations', format: 'percent', direction: 'up-good', min: 62, max: 97, target: 90 },
  { label: 'Automated hours / month', capabilityId: 'automation', format: 'number', direction: 'up-good', min: 2, max: 46 },
  { label: 'Strategy confidence', capabilityId: 'strategy', format: 'score', direction: 'up-good', min: 45, max: 88, target: 75 },
];

export function makeKpis(ctx: GenCtx): Kpi[] {
  const { rng, draft } = ctx;
  return KPI_SEEDS.map((seed, i) => {
    const decimals = seed.format === 'percent' ? 1 : 0;
    const value = round(rng.float(seed.min, seed.max), decimals);
    const history = series(rng, value, 12, seed.format === 'money' ? 0.14 : 0.09);
    const previous = history[history.length - 2] ?? value;
    return {
      ...base(ctx, 'kpi', `${i}:${seed.label}`),
      label: seed.label,
      value,
      previousValue: previous,
      ...(seed.target === undefined ? {} : { target: seed.target }),
      format: seed.format,
      currency: draft.baseCurrency,
      direction: seed.direction,
      capabilityId: seed.capabilityId,
      series: history,
      period: 'Last 12 months',
    } satisfies Kpi;
  });
}

/* ----------------------------------------------------------------- tasks -- */

export const TASK_SEEDS: ReadonlyArray<[string, string, Task['priority'], Task['energy'], number]> = [
  ['Write the one-page positioning statement', 'strategy', 'p0', 'deep', 90],
  ['Decide the first beachhead segment', 'strategy', 'p0', 'deep', 120],
  ['Draft the offer and price it', 'sales', 'p1', 'deep', 90],
  ['Build the outreach list for the beachhead', 'sales', 'p1', 'moderate', 60],
  ['Set up the first campaign', 'marketing', 'p1', 'moderate', 120],
  ['Write three pieces of proof-of-work content', 'marketing', 'p2', 'deep', 180],
  ['Lock the brand basics: mark, type, palette', 'branding', 'p2', 'moderate', 120],
  ['Stand up the landing page', 'development', 'p1', 'deep', 240],
  ['Set up the ledger and chart of accounts', 'finance', 'p0', 'moderate', 60],
  ['Build the 12-month cash forecast', 'finance', 'p1', 'deep', 90],
  ['Write the delivery SOP', 'operations', 'p1', 'moderate', 90],
  ['Define what "done" means for a delivery', 'operations', 'p2', 'moderate', 45],
  ['Check contract template against the offer', 'legal', 'p2', 'moderate', 60],
  ['Automate the weekly status roll-up', 'automation', 'p2', 'light', 45],
  ['Map the competitive landscape properly', 'research', 'p2', 'deep', 120],
  ['Decide which capabilities stay off for now', 'executive', 'p3', 'light', 20],
];

export function makeTasks(ctx: GenCtx): Task[] {
  const { rng, now } = ctx;
  return TASK_SEEDS.map(([title, capabilityId, priority, energy, estimate], i) => {
    const roll = rng.next();
    const status: Task['status'] =
      i < 2 ? 'active' : roll < 0.16 ? 'done' : roll < 0.3 ? 'next' : roll < 0.38 ? 'blocked' : 'backlog';
    return {
      ...base(ctx, 'task', `${i}:${title}`),
      title,
      status,
      priority,
      capabilityId,
      energy,
      estimateMinutes: estimate,
      dueDate: dayOnly(addDays(now, rng.int(2, 45))),
      ...(status === 'done' ? { completedAt: iso(addDays(now, -rng.int(1, 14))) } : {}),
      ...(status === 'blocked'
        ? { blockedReason: rng.pick(['Waiting on a decision', 'Needs the offer priced first', 'Blocked on an external reply']) }
        : {}),
      source: 'seed' as const,
    } satisfies Task;
  });
}

/* --------------------------------------------------------------- roadmap -- */

export function makeRoadmap(ctx: GenCtx): RoadmapItem[] {
  const { rng } = ctx;
  const seeds: ReadonlyArray<[string, string, RoadmapItem['stage'], string]> = [
    ['Public site and proof-of-work pages', 'development', 'building', 'This quarter'],
    ['Client intake and quoting flow', 'development', 'planned', 'This quarter'],
    ['Delivery tracking with photo evidence', 'operations', 'planned', 'Next quarter'],
    ['Automated monthly reporting pack', 'automation', 'idea', 'Next quarter'],
    ['Self-serve quote estimator', 'development', 'idea', 'H2'],
    ['Second-market playbook', 'strategy', 'idea', 'H2'],
    ['Partner/referral programme', 'marketing', 'parked', 'Unscheduled'],
  ];
  return seeds.map(([title, capabilityId, stage, horizon], i) => ({
    ...base(ctx, 'road', `${i}:${title}`),
    title,
    summary: '',
    stage,
    horizon,
    capabilityId,
    confidence: round(rng.float(0.3, 0.9), 2),
  }));
}
