/**
 * Automations, docs, suggestions, risks and starter memory for personal life.
 */

import {
  makeRecordId,
  type Automation,
  type Goal,
  type Habit,
  type KnowledgeDoc,
  type MemoryRecord,
  type RiskItem,
  type Suggestion,
} from '@/lib/domain';
import { round, type Rng } from '../rng';
import { addDays, base, iso } from './shared';

export function makeAutomations(now: Date): Automation[] {
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

export function makeDocs(now: Date): KnowledgeDoc[] {
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

export function makeSuggestions(rng: Rng, now: Date): Suggestion[] {
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

export function makeRisks(now: Date): RiskItem[] {
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

export function makeMemory(now: Date): MemoryRecord[] {
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
