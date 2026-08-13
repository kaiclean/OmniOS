/**
 * Personal headquarters generation.
 *
 * Personal life is not a lighter version of a company — it is a full space with
 * its own DNA, its own capabilities and its own record types. It is generated the
 * same way a company is, through the same registry, which is what keeps the two
 * genuinely symmetrical instead of one being a bolted-on afterthought.
 */

import type {
  Automation,
  CalendarBlock,
  FinanceEntry,
  Goal,
  Habit,
  HealthDay,
  KnowledgeDoc,
  Kpi,
  LearningItem,
  LifeAdminItem,
  MemoryRecord,
  PersonalProfile,
  Relationship,
  RiskItem,
  Suggestion,
  Task,
} from '@/lib/domain';
import { makeRecordId, money, personalScope } from '@/lib/domain';
import type { ScopeData } from '@/lib/data/schema';
import { emptyScopeData } from '@/lib/data/schema';
import { deriveEnergy } from '@/lib/personal/energy';
import type { Rng } from './rng';
import { createRng, round, series } from './rng';

const SEED = 'personal:v1';

const iso = (d: Date): string => d.toISOString();
const dayOnly = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

function base(kind: string, seed: string, now: Date) {
  return {
    id: makeRecordId(kind, `personal:${seed}`),
    scope: personalScope(),
    createdAt: iso(now),
    updatedAt: iso(now),
  };
}

/* -------------------------------------------------------------- profile --- */

export function makePersonalProfile(displayName: string, now: Date): PersonalProfile {
  return {
    id: 'personal',
    displayName,
    timezone: 'Europe/Zurich',
    baseCurrency: 'CHF',
    createdAt: iso(now),
    updatedAt: iso(now),
    dna: {
      identity:
        'A builder who thinks in systems. Happiest turning an ambiguous idea into something that runs, and unhappy when the work outruns the body carrying it.',
      values: [
        'Truth over comfort',
        'Build it, then prove it works',
        'Health is infrastructure, not a reward',
        'Depth over breadth',
        'Keep promises small enough to keep',
      ],
      lifeGoals: [
        'Run companies that do not require me to be present to survive',
        'Stay strong and clear-headed into my sixties',
        'Keep the people close who were there before any of this',
        'Learn something structurally new every year',
      ],
      longTermVision:
        'One system that carries the operational weight of several companies and a full life, so the remaining human hours go to judgement, craft and people.',
      healthPhilosophy:
        'Sleep first, then movement, then everything else. Recovery is measured, not guessed. A bad week is data, not a verdict.',
      financialGoals: [
        'Twelve months of personal runway held separately from any company',
        'Fixed costs covered by recurring income',
        'No debt that funds operations',
      ],
      lifestylePreferences: [
        'Deep work in the morning, meetings after 14:00',
        'One full day a week with no screens',
        'Travel that has a reason, not a schedule',
      ],
      nonNegotiables: [
        'Seven hours of sleep on working nights',
        'Family time is not moveable for work',
        'No commitment made while tired',
      ],
    },
    personalBrand: {
      voice: ['Direct', 'Specific', 'Unhurried', 'Evidence-first'],
      tone: 'Someone who has built the thing they are talking about.',
      palette: [
        { name: 'Ground', value: '#0B0B0C', role: 'surface' },
        { name: 'Bone', value: '#EDEBE7', role: 'primary' },
        { name: 'Ash', value: '#8B8D93', role: 'secondary' },
        { name: 'Ember', value: '#C08A5A', role: 'accent' },
      ],
      typography: 'One grotesque, tight tracking, generous line height.',
      imagery: 'Workshops, screens, mountains. Nothing staged.',
      doNot: ['No hustle language', 'No claims about outcomes not yet reached', 'Never perform certainty'],
      taglines: ['Systems, not shortcuts.'],
    },
    disabledCapabilityIds: [],
  };
}

/* --------------------------------------------------------------- health --- */

function makeHealth(rng: Rng, now: Date): HealthDay[] {
  const days: HealthDay[] = [];
  for (let back = 89; back >= 0; back -= 1) {
    const date = addDays(now, -back);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;

    // A real founder's data has gaps — a forgotten ring, a night away.
    const logged = rng.bool(0.88);
    if (!logged) {
      days.push({ ...base('health', `d${back}`, now), date: dayOnly(date), notes: 'Not tracked' });
      continue;
    }

    const sleepHours = round(rng.float(weekend ? 6.6 : 5.6, weekend ? 8.9 : 8.1), 1);
    const sleepQuality = Math.round(clamp(rng.float(45, 96) + (sleepHours - 7) * 6, 20, 99));
    const hrv = Math.round(clamp(rng.float(38, 82) + (sleepHours - 7) * 4, 22, 99));
    const stress = Math.round(clamp(rng.float(18, 74) - (sleepHours - 7) * 5, 5, 95));
    const trained = rng.bool(weekend ? 0.5 : 0.62);
    const workoutMinutes = trained ? rng.int(28, 85) : 0;

    const day: HealthDay = {
      ...base('health', `d${back}`, now),
      date: dayOnly(date),
      sleepHours,
      sleepQuality,
      restingHeartRate: Math.round(clamp(rng.float(48, 62) - (hrv - 55) * 0.08, 44, 70)),
      hrv,
      steps: rng.int(3_200, 14_500),
      workoutMinutes,
      ...(trained ? { workoutKind: rng.pick(['Strength', 'Zone 2', 'Climbing', 'Ski touring', 'Swim']) } : {}),
      stress,
      mood: Math.round(clamp(rng.float(40, 95) - stress * 0.2, 15, 99)),
    };
    days.push({ ...day, energy: deriveEnergy(day).score ?? undefined });
  }
  return days;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* --------------------------------------------------------------- habits --- */

function makeHabits(rng: Rng, now: Date): Habit[] {
  const seeds: ReadonlyArray<[string, Habit['cadence'], string, number, number]> = [
    ['Lights out before 23:00', 'daily', 'Sleep is the input everything else depends on.', 7, 0.72],
    ['Strength training', 'weekly', 'Keeps the body able to carry the work.', 3, 0.66],
    ['Morning deep work block', 'weekdays', 'The only hours that reliably produce the hard thing.', 5, 0.81],
    ['Walk without a phone', 'daily', 'Where most of the good decisions actually happen.', 5, 0.55],
    ['Weekly review', 'weekly', 'Closes the loop so nothing quietly rots.', 1, 0.7],
    ['One screen-free day', 'weekly', 'Non-negotiable, and the first thing to slip.', 1, 0.42],
  ];
  return seeds.map(([name, cadence, intent, targetPerWeek, rate], i) => {
    const completions: string[] = [];
    for (let back = 0; back < 60; back += 1) {
      if (rng.bool(rate * (cadence === 'weekly' ? 0.3 : 1))) {
        completions.push(dayOnly(addDays(now, -back)));
      }
    }
    return {
      ...base('habit', `${i}:${name}`, now),
      name,
      cadence,
      intent,
      completions,
      targetPerWeek,
      archived: false,
    };
  });
}

/* -------------------------------------------------------- relationships --- */

function makeRelationships(rng: Rng, now: Date): Relationship[] {
  const seeds: ReadonlyArray<[string, Relationship['circle'], string, number]> = [
    ['Mum', 'family', 'Mother', 7],
    ['Dad', 'family', 'Father', 10],
    ['Lena', 'family', 'Sister', 14],
    ['Marc', 'inner', 'Oldest friend', 14],
    ['Sofia', 'inner', 'Close friend', 21],
    ['Daniel', 'friends', 'Climbing partner', 30],
    ['Priya', 'mentors', 'Former manager, still the best advice', 60],
    ['Tobias', 'network', 'Runs an agency, good for introductions', 90],
    ['Nina', 'friends', 'Studied together', 45],
  ];
  return seeds.map(([name, circle, relation, cadenceDays], i) => ({
    ...base('rel', `${i}:${name}`, now),
    name,
    circle,
    relation,
    cadenceDays,
    lastContactAt: iso(addDays(now, -rng.int(1, Math.round(cadenceDays * 1.9)))),
    nextIntent: rng.bool(0.4)
      ? rng.pick(['Call, not text', 'Invite for dinner', 'Send the book we talked about', 'Ask how the move went'])
      : undefined,
  }));
}

/* ------------------------------------------------------------- learning --- */

function makeLearning(rng: Rng, now: Date): LearningItem[] {
  const seeds: ReadonlyArray<[string, LearningItem['kind'], string, string, string[]]> = [
    [
      'Thinking in Systems',
      'book',
      'Donella Meadows',
      'Because most of my problems are structural, not effort problems.',
      ['strategy', 'operations'],
    ],
    [
      'Designing Data-Intensive Applications',
      'book',
      'Martin Kleppmann',
      'To stop guessing about storage and consistency.',
      ['development'],
    ],
    [
      'Financial modelling for operators',
      'course',
      '—',
      'So the forecast is mine, not an accountant’s black box.',
      ['finance'],
    ],
    ['Colour and light for photography', 'skill', '—', 'Better product imagery without hiring it out.', ['creative']],
    ['German technical writing', 'skill', '—', 'Documentation that reads natively for local clients.', ['operations']],
    ['Sleep and circadian performance', 'paper', '—', 'Because everything downstream depends on it.', ['health']],
  ];
  return seeds.map(([title, kind, author, why, appliesTo], i) => {
    const progress = round(rng.float(0.05, 0.95), 2);
    return {
      ...base('learn', `${i}:${title}`, now),
      title,
      kind,
      ...(author === '—' ? {} : { author }),
      progress,
      status: (progress > 0.92 ? 'finished' : progress < 0.08 ? 'queued' : 'active') as LearningItem['status'],
      why,
      insights:
        progress > 0.3
          ? [
              'The leverage is almost never where the effort feels heaviest.',
              'Write the note when the idea lands, not when the book ends.',
            ].slice(0, rng.int(1, 2))
          : [],
      appliesTo,
    };
  });
}

/* ----------------------------------------------------------- life admin --- */

function makeLifeAdmin(rng: Rng, now: Date): LifeAdminItem[] {
  const seeds: ReadonlyArray<[string, LifeAdminItem['kind'], number, string]> = [
    ['Dentist — six-month check', 'appointment', 21, 'Stans'],
    ['Renew passport', 'renewal', 62, ''],
    ['File Q3 tax paperwork', 'admin', 35, ''],
    ['Health insurance comparison before deadline', 'admin', 48, ''],
    ['Trip to Milan — book train and hotel', 'travel', 26, 'Milan'],
    ['Car service', 'appointment', 12, ''],
    ['Archive last year’s documents', 'document', 90, ''],
    ['Physio follow-up', 'appointment', 5, 'Luzern'],
  ];
  return seeds.map(([title, kind, inDays, location], i) => ({
    ...base('life', `${i}:${title}`, now),
    title,
    kind,
    dueDate: dayOnly(addDays(now, inDays)),
    status: (inDays < 10 ? 'scheduled' : 'open') as LifeAdminItem['status'],
    ...(location ? { location } : {}),
    detail: rng.bool(0.3) ? 'Moved once already — do not move again.' : undefined,
  }));
}

/* ------------------------------------------------------------- calendar --- */

function makeCalendar(rng: Rng, now: Date, companyKeys: readonly string[]): CalendarBlock[] {
  const blocks: CalendarBlock[] = [];
  for (let ahead = 0; ahead < 7; ahead += 1) {
    const date = addDays(now, ahead);
    const weekday = date.getUTCDay();
    if (weekday === 0) {
      blocks.push({
        ...base('cal', `rest:${ahead}`, now),
        title: 'Screen-free day',
        date: dayOnly(date),
        startMinute: 9 * 60,
        durationMinutes: 480,
        kind: 'rest',
        spaceKey: 'personal',
      });
      continue;
    }
    blocks.push({
      ...base('cal', `deep:${ahead}`, now),
      title: 'Deep work',
      date: dayOnly(date),
      startMinute: 8 * 60 + 30,
      durationMinutes: 150,
      kind: 'deep-work',
      spaceKey: companyKeys[ahead % Math.max(1, companyKeys.length)] ?? 'personal',
    });
    if (weekday !== 6) {
      blocks.push({
        ...base('cal', `meet:${ahead}`, now),
        title: rng.pick(['Client call', 'Supplier review', 'Team sync', 'Advisor call']),
        date: dayOnly(date),
        startMinute: 14 * 60 + rng.int(0, 3) * 30,
        durationMinutes: 45,
        kind: 'meeting',
        spaceKey: companyKeys[(ahead + 1) % Math.max(1, companyKeys.length)] ?? 'personal',
      });
      blocks.push({
        ...base('cal', `train:${ahead}`, now),
        title: rng.pick(['Strength', 'Zone 2', 'Climbing']),
        date: dayOnly(date),
        startMinute: 18 * 60,
        durationMinutes: 60,
        kind: 'personal',
        spaceKey: 'personal',
      });
    }
  }
  return blocks;
}

/* --------------------------------------------------- the rest of a life --- */

function makeGoals(rng: Rng, now: Date): Goal[] {
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

function makeKpis(rng: Rng, now: Date, health: readonly HealthDay[]): Kpi[] {
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

function makeTasks(rng: Rng, now: Date): Task[] {
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

function makeFinance(rng: Rng, now: Date): FinanceEntry[] {
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

function makeAutomations(now: Date): Automation[] {
  const seeds: ReadonlyArray<[string, string, string, Automation['trigger'], string, Array<[string, string, boolean]>, number]> = [
    [
      'Sunday life reset',
      'Pulls next week’s calendar, open life admin and who is overdue a call into one short list.',
      'life-ops',
      'schedule',
      'Every Sunday, 18:00',
      [
        ['Collect the week ahead across every space', 'chief-of-staff', false],
        ['List overdue relationships and admin', 'life-coach', false],
      ],
      35,
    ],
    [
      'Recovery guard',
      'When recovery is low two days running, it proposes a lighter schedule before the week is committed.',
      'health',
      'threshold',
      'Energy under 50 for two consecutive days',
      [
        ['Read the recovery trend', 'health', false],
        ['Propose a reduced deep-work budget', 'chief-of-staff', false],
      ],
      0,
    ],
    [
      'Document filing',
      'Sorts incoming documents into the right folder and flags anything with a deadline.',
      'life-ops',
      'event',
      'A document is added',
      [['Classify and file', 'operator', false], ['Extract any deadline into life admin', 'chief-of-staff', false]],
      15,
    ],
    [
      'Monthly personal close',
      'Reconciles personal spend, updates runway and flags anything unusual.',
      'finance',
      'schedule',
      'First of the month',
      [['Reconcile the month', 'cfo', false], ['Recompute runway', 'cfo', false]],
      40,
    ],
  ];
  return seeds.map(([name, description, capabilityId, trigger, triggerDetail, stepSpecs, saved], i) => ({
    ...base('auto', `${i}:${name}`, now),
    name,
    description,
    capabilityId,
    status: (i < 2 ? 'armed' : 'draft') as Automation['status'],
    trigger,
    triggerDetail,
    steps: stepSpecs.map(([label, specialistId, external], k) => ({
      id: makeRecordId('step', `personal:${name}:${k}`),
      label,
      specialistId,
      external,
    })),
    lastRunAt: i < 2 ? iso(addDays(now, -3)) : undefined,
    runsThisMonth: i < 2 ? 4 : 0,
    minutesSavedPerRun: saved,
    requiresApproval: stepSpecs.some(([, , external]) => external),
  }));
}

function makeDocs(now: Date): KnowledgeDoc[] {
  const seeds: ReadonlyArray<[string, KnowledgeDoc['kind'], string, string]> = [
    [
      'Operating rules for myself',
      'sop',
      'life-ops',
      'No commitment made after 21:00. No decision made tired. If it is not in the system, it does not exist. One day a week fully offline.',
    ],
    [
      'What a good week looks like',
      'note',
      'health',
      'Three training sessions, five morning deep-work blocks, sleep above seven on most nights, one long walk, one real conversation that was not about work.',
    ],
    [
      'Emergency and important documents',
      'doc',
      'life-ops',
      'Locations recorded here; contents never stored in this system.',
    ],
    [
      'Decision: keep personal runway outside the companies',
      'decision',
      'finance',
      'Personal runway sits in a separate account no company can reach. It exists so business decisions are never made from personal fear.',
    ],
  ];
  return seeds.map(([title, kind, capabilityId, body], i) => ({
    ...base('doc', `${i}:${title}`, now),
    title,
    body,
    kind,
    capabilityId,
    tags: [capabilityId],
    source: 'seed' as const,
  }));
}

function makeSuggestions(rng: Rng, now: Date): Suggestion[] {
  const seeds: ReadonlyArray<[string, string, string, string, Suggestion['impact'], Suggestion['effort'], string[]]> = [
    [
      'Protect Thursday morning',
      'Recovery has been under target twice this week and Thursday is the only unbooked deep-work block left. Losing it costs the week’s hardest task.',
      'health',
      'health',
      'high',
      'low',
      ['Energy below 60 on 2 of the last 5 days', 'Thursday 08:30 block still unbooked'],
    ],
    [
      'Three people are past their cadence',
      'Marc, Priya and Nina are all overdue. None of it is urgent, which is exactly why it slips for months.',
      'relationships',
      'life-coach',
      'medium',
      'low',
      ['3 relationships past their intended cadence', 'No reach-out tasks currently scheduled'],
    ],
    [
      'Personal runway is below target',
      'Runway sits under the twelve-month goal. The gap is small enough to close with two months of disciplined transfer.',
      'finance',
      'cfo',
      'high',
      'medium',
      ['KPI "Personal runway" below target', 'Goal: twelve months held separately'],
    ],
    [
      'Move the screen-free day to Sunday permanently',
      'It survives on Sundays and collapses on any other day. Making it fixed removes the weekly negotiation.',
      'life-ops',
      'life-coach',
      'medium',
      'low',
      ['Habit "One screen-free day" at 42% adherence', 'Sunday blocks show highest completion'],
    ],
  ];
  return seeds.map(([title, rationale, capabilityId, specialistId, impact, effort, evidence], i) => ({
    ...base('sug', `${i}:${title}`, now),
    title,
    rationale,
    capabilityId,
    specialistId,
    impact,
    effort,
    confidence: round(rng.float(0.6, 0.94), 2),
    status: 'open' as const,
    evidence,
    simulated: true,
  }));
}

function makeRisks(now: Date): RiskItem[] {
  const seeds: ReadonlyArray<[string, string, RiskItem['severity'], RiskItem['kind'], string, string]> = [
    [
      'Sleep debt accumulating across working weeks',
      'Average sleep sits under the seven-hour non-negotiable on weekdays, and recovery has not fully returned on any recent Monday.',
      'high',
      'risk',
      'health',
      'Hard stop at 23:00 on working nights; no commitments booked before 09:00.',
    ],
    [
      'Personal finances entangled with company cash flow',
      'A tight month in a company would reach personal life directly.',
      'medium',
      'risk',
      'finance',
      'Keep the personal runway in a separate account and never draw from it for operations.',
    ],
    [
      'Relationships maintained reactively',
      'Contact happens when something prompts it, which means the quiet months go unnoticed until they are long.',
      'medium',
      'bottleneck',
      'relationships',
      'Cadence per person, with gentle nudges rather than a task list.',
    ],
  ];
  return seeds.map(([label, detail, severity, kind, capabilityId, mitigation], i) => ({
    ...base('risk', `${i}:${label}`, now),
    label,
    detail,
    severity,
    kind,
    capabilityId,
    mitigation,
  }));
}

function makeMemory(now: Date): MemoryRecord[] {
  const seeds: ReadonlyArray<[MemoryRecord['kind'], string, string, number]> = [
    ['preference', 'Deep work happens in the morning; meetings are pushed past 14:00.', 'life-ops', 0.95],
    ['preference', 'Prefers being told the uncomfortable version first, without cushioning.', 'executive', 0.9],
    ['pattern', 'Energy drops predictably two days after any night under six hours.', 'health', 0.85],
    ['decision', 'Personal runway is held outside every company account.', 'finance', 0.95],
    ['style', 'Writes and thinks in systems: prefers a diagram or a model to a list.', 'executive', 0.8],
    ['lesson', 'Commitments made while tired are the ones later regretted.', 'executive', 0.75],
    ['fact', 'Based in Central Switzerland; works across German, English and some French.', 'life-ops', 0.9],
  ];
  return seeds.map(([kind, text, capabilityId, strength], i) => ({
    ...base('mem', `${i}:${text}`, now),
    kind,
    text,
    capabilityId,
    strength,
    tags: [capabilityId],
    source: 'observation' as const,
    useCount: 0,
  }));
}

/* -------------------------------------------------------------- assembly -- */

export interface GeneratedPersonal {
  readonly profile: PersonalProfile;
  readonly data: ScopeData;
}

export function generatePersonalWorkspace(
  displayName: string,
  companyScopeKeys: readonly string[],
  now: Date = new Date(),
): GeneratedPersonal {
  const rng = createRng(SEED);
  const health = makeHealth(rng, now);

  const data: ScopeData = {
    ...emptyScopeData(),
    health,
    habits: makeHabits(rng, now),
    relationships: makeRelationships(rng, now),
    learning: makeLearning(rng, now),
    lifeAdmin: makeLifeAdmin(rng, now),
    calendar: makeCalendar(rng, now, companyScopeKeys),
    goals: makeGoals(rng, now),
    kpis: makeKpis(rng, now, health),
    tasks: makeTasks(rng, now),
    finance: makeFinance(rng, now),
    automations: makeAutomations(now),
    docs: makeDocs(now),
    suggestions: makeSuggestions(rng, now),
    risks: makeRisks(now),
    memory: makeMemory(now),
  };

  return { profile: makePersonalProfile(displayName, now), data };
}

/** Kept exported so tests and the reset flow can rebuild an empty-but-valid life. */
export function emptyPersonalWorkspace(displayName: string, now: Date = new Date()): GeneratedPersonal {
  return { profile: makePersonalProfile(displayName, now), data: emptyScopeData() };
}
