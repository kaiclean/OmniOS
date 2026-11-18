/**
 * Automations and the knowledge base (SOPs and docs).
 *
 * Automation steps that leave the machine are flagged `external`, which is what
 * makes the approval gate stop them.
 */

import {
  makeRecordId,
  type Automation,
  type AutomationStep,
  type KnowledgeDoc,
} from '@/lib/domain';
import { addDays, base, iso, type GenCtx } from './shared';

/* ----------------------------------------------------------- automations -- */

function steps(ctx: GenCtx, seed: string, specs: ReadonlyArray<[string, string, boolean]>): AutomationStep[] {
  return specs.map(([label, specialistId, external], i) => ({
    id: makeRecordId('step', `${ctx.companyId}:${seed}:${i}`),
    label,
    specialistId,
    external,
  }));
}

export function makeAutomations(ctx: GenCtx): Automation[] {
  const { rng, now } = ctx;
  const seeds: ReadonlyArray<{
    name: string;
    description: string;
    capabilityId: string;
    trigger: Automation['trigger'];
    triggerDetail: string;
    steps: ReadonlyArray<[string, string, boolean]>;
    saved: number;
  }> = [
    {
      name: 'Monday operating review',
      description: 'Assembles last week’s numbers, open blockers and the three things that matter into one brief.',
      capabilityId: 'operations',
      trigger: 'schedule',
      triggerDetail: 'Every Monday, 07:00',
      steps: [
        ['Pull KPI movement and flag anomalies', 'analyst', false],
        ['Collect blocked work and stale follow-ups', 'project-manager', false],
        ['Write the brief in the founder’s voice', 'chief-of-staff', false],
      ],
      saved: 45,
    },
    {
      name: 'Invoice chase',
      description: 'Finds overdue invoices and drafts the follow-up. Sending stays manual until approved.',
      capabilityId: 'finance',
      trigger: 'threshold',
      triggerDetail: 'Invoice more than 14 days overdue',
      steps: [
        ['Identify overdue entries in the ledger', 'cfo', false],
        ['Draft a firm, polite follow-up', 'copywriter', false],
        ['Queue for approval before sending', 'chief-of-staff', true],
      ],
      saved: 25,
    },
    {
      name: 'Content pipeline',
      description: 'Turns one piece of finished work into a set of on-brand posts, held as drafts.',
      capabilityId: 'marketing',
      trigger: 'event',
      triggerDetail: 'A delivery is marked complete',
      steps: [
        ['Extract the story from the delivery record', 'copywriter', false],
        ['Produce platform variants', 'social', false],
        ['Check against Brand DNA', 'brand', false],
      ],
      saved: 70,
    },
    {
      name: 'Pipeline hygiene',
      description: 'Flags deals with no movement and suggests the next concrete step.',
      capabilityId: 'sales',
      trigger: 'schedule',
      triggerDetail: 'Every Thursday, 16:00',
      steps: [
        ['Find contacts past their follow-up date', 'sales', false],
        ['Draft a specific next step per contact', 'sales', false],
      ],
      saved: 30,
    },
    {
      name: 'Month-end close pack',
      description: 'Reconciles the month, produces the P&L view and lists what needs a human decision.',
      capabilityId: 'finance',
      trigger: 'schedule',
      triggerDetail: 'Last working day of the month',
      steps: [
        ['Reconcile actuals against forecast', 'cfo', false],
        ['Explain every variance over 10%', 'analyst', false],
        ['List decisions needing the founder', 'chief-of-staff', false],
      ],
      saved: 120,
    },
    {
      name: 'Documentation catch-up',
      description: 'Notices processes executed three times with no SOP and drafts one.',
      capabilityId: 'operations',
      trigger: 'threshold',
      triggerDetail: 'A sequence repeats three times',
      steps: [
        ['Detect the repeated sequence', 'operator', false],
        ['Draft the SOP from what actually happened', 'operator', false],
      ],
      saved: 55,
    },
  ];

  return seeds.map((seed, i) => ({
    ...base(ctx, 'auto', `${i}:${seed.name}`),
    name: seed.name,
    description: seed.description,
    capabilityId: seed.capabilityId,
    status: (i < 3 ? 'armed' : i < 5 ? 'draft' : 'paused') as Automation['status'],
    trigger: seed.trigger,
    triggerDetail: seed.triggerDetail,
    steps: steps(ctx, seed.name, seed.steps),
    lastRunAt: i < 3 ? iso(addDays(now, -rng.int(1, 9))) : undefined,
    runsThisMonth: i < 3 ? rng.int(1, 6) : 0,
    minutesSavedPerRun: seed.saved,
    requiresApproval: seed.steps.some(([, , external]) => external),
  }));
}

/* ------------------------------------------------------------ knowledge --- */

export function makeDocs(ctx: GenCtx): KnowledgeDoc[] {
  const { draft } = ctx;
  const seeds: ReadonlyArray<[string, KnowledgeDoc['kind'], string, string]> = [
    [
      'How we decide what to build next',
      'decision',
      'strategy',
      'Rank by: does it remove a bottleneck, does it produce evidence, can it ship inside two weeks. Anything that fails all three waits.',
    ],
    [
      'Delivery SOP (v1)',
      'sop',
      'operations',
      'Intake → scope → confirm in writing → schedule → deliver → photo evidence → invoice → follow-up at day 14. Every step has a named owner and a definition of done.',
    ],
    [
      'Pricing rationale',
      'doc',
      'finance',
      'Price on the value of the outcome and the cost of the alternative, never on hours. Discounts are traded for scope or certainty, never given.',
    ],
    [
      'Brand guidelines — short form',
      'doc',
      'branding',
      'One typeface. Real photography. Never claim more than we can show. If a sentence could have been written by any competitor, rewrite it.',
    ],
    [
      'Qualification checklist',
      'sop',
      'sales',
      'Budget named, decision-maker in the room, a real deadline, and a problem they can describe without our help. Three of four or it stays a lead.',
    ],
    [
      'Incident and complaint handling',
      'sop',
      'operations',
      'Acknowledge inside two hours. Own it without excuses. Fix it. Write down what caused it. Change the process, not the person.',
    ],
    [
      `Why ${draft.name} exists`,
      'note',
      'strategy',
      draft.description,
    ],
    [
      'Weekly operating rhythm',
      'sop',
      'operations',
      'Monday: review numbers and set the week. Wednesday: unblock. Friday: close the loop, write down what was learned.',
    ],
  ];
  return seeds.map(([title, kind, capabilityId, body], i) => ({
    ...base(ctx, 'doc', `${i}:${title}`),
    title,
    body,
    kind,
    capabilityId,
    tags: [capabilityId],
    source: 'seed' as const,
  }));
}
