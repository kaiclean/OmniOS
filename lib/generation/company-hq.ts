/**
 * Company headquarters generation.
 *
 * This is the mechanism behind the product's central promise: a founder fills in
 * a short form, and a complete, populated headquarters exists a moment later —
 * DNA, brand, goals, KPIs, roadmap, ledger, pipeline, SOPs, automations, risks
 * and recommendations, all wired to the Capability registry.
 *
 * Everything produced here is marked `simulated` / `source: 'seed'` where it is a
 * starting point rather than an observation. The OS shows that distinction in the
 * UI: a founder should never mistake a generated placeholder for a measured fact.
 */

import type {
  Automation,
  AutomationStep,
  Company,
  CompanyDraft,
  Contact,
  CreativeAsset,
  CreativeBrief,
  FinanceEntry,
  Goal,
  KnowledgeDoc,
  Kpi,
  MemoryRecord,
  RiskItem,
  RoadmapItem,
  Suggestion,
  Task,
} from '@/lib/domain';
import { companyScope, makeId, makeRecordId, money, slugify } from '@/lib/domain';
import type { ScopeData } from '@/lib/data/schema';
import { emptyScopeData } from '@/lib/data/schema';
import { CAPABILITIES, capabilitiesFor } from '@/lib/capabilities/registry';
import { specialistsForCapability } from '@/lib/ai/specialists';
import type { Rng } from './rng';
import { createRng, round, series } from './rng';

interface GenCtx {
  readonly rng: Rng;
  readonly companyId: string;
  readonly now: Date;
  readonly draft: CompanyDraft;
}

const iso = (d: Date): string => d.toISOString();
const dayOnly = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

function base(ctx: GenCtx, kind: string, seed: string) {
  return {
    id: makeRecordId(kind, `${ctx.companyId}:${seed}`),
    scope: companyScope(ctx.companyId),
    createdAt: iso(ctx.now),
    updatedAt: iso(ctx.now),
  };
}

/* ------------------------------------------------------------------ DNA --- */

const VALUE_POOL = [
  'Evidence before opinion',
  'Ship the smallest honest version',
  'Say the hard thing early',
  'Craft over volume',
  'Leave the system better documented than you found it',
  'No number we cannot defend',
  'Speed, but never at the cost of trust',
  'Own the outcome, not the task',
];

const VOICE_POOL = [
  'Direct',
  'Precise',
  'Warm but unsentimental',
  'Concrete',
  'Confident without hype',
  'Plain-spoken',
  'Technical when it earns its place',
];

const DO_NOT_POOL = [
  'No stock-photo handshakes',
  'No superlatives we cannot evidence',
  'Never claim autonomy the system does not have',
  'No exclamation marks',
  'Never describe a prototype as production',
  'No jargon where a plain word exists',
];

function makeDna(ctx: GenCtx): Company['dna'] {
  const { rng, draft } = ctx;
  const audienceSeeds = [
    ['Owner-operators', 'Runs the business and the work. Buys time back, not features.'],
    ['Operations leads', 'Judged on throughput and predictability. Hates surprises.'],
    ['Technical founders', 'Will read the docs. Distrusts anything that hides its mechanism.'],
    ['Procurement', 'Needs a defensible reason to sign. Cares about risk, not delight.'],
  ] as const;

  return {
    mission: draft.mission,
    vision: draft.vision,
    purpose: `${draft.name} exists because ${draft.description.replace(/\.$/, '')} — and because doing it well is still rare in ${draft.industry.toLowerCase()}.`,
    values: rng.sample(VALUE_POOL, 4),
    businessModel: draft.businessModel,
    targetAudience: rng.sample([...audienceSeeds], 2).map(([label, description], i) => ({
      id: makeId(label, `${ctx.companyId}:aud:${i}`),
      label,
      description,
      pains: rng.sample(
        [
          'Work that only exists because a system does not',
          'No single place where the real state lives',
          'Decisions made on stale numbers',
          'Quality that depends on one person being available',
          'Cost that is invisible until the quarter closes',
        ],
        2,
      ),
    })),
    competitors: [
      {
        id: makeId('incumbent', `${ctx.companyId}:c1`),
        name: 'The incumbent',
        positioning: 'Trusted, slow, priced on inertia.',
        threat: 'medium' as const,
      },
      {
        id: makeId('cheap alternative', `${ctx.companyId}:c2`),
        name: 'The cheap alternative',
        positioning: 'Wins on price, loses on follow-through.',
        threat: 'low' as const,
      },
      {
        id: makeId('status quo', `${ctx.companyId}:c3`),
        name: 'Doing nothing',
        positioning: 'The real competitor. Free, familiar, and quietly expensive.',
        threat: 'high' as const,
      },
    ],
    longTermStrategy: `Win a narrow beachhead in ${draft.industry.toLowerCase()} on quality and reliability, systematise what works into repeatable operations, then widen the offer without widening the cost base.`,
    moat: 'Accumulated operating knowledge, encoded as process rather than held in one head.',
  };
}

function makeBrand(ctx: GenCtx): Company['brand'] {
  const { rng, draft } = ctx;
  const hueSeeded = [
    { name: 'Ink', value: '#0E1013', role: 'surface' as const },
    { name: 'Signal', value: '#C7A87A', role: 'primary' as const },
    { name: 'Stone', value: '#8A9099', role: 'secondary' as const },
    { name: 'Accent', value: '#5E8C7E', role: 'accent' as const },
  ];
  return {
    voice: rng.sample(VOICE_POOL, 4),
    tone: `Assured and specific. ${draft.name} sounds like someone who has actually done the work.`,
    palette: hueSeeded,
    typography: 'One grotesque for everything. Weight and size carry hierarchy, not extra families.',
    imagery: 'Real work, real sites, real hands. Available light. No composites.',
    doNot: rng.sample(DO_NOT_POOL, 4),
    taglines: [
      `${draft.name} — ${draft.mission.replace(/\.$/, '').toLowerCase()}.`,
      'Built to be relied on.',
    ],
  };
}

/* ---------------------------------------------------------------- goals --- */

/** The goals the founder actually typed — real records in every mode, including a clean slate. */
function founderGoals(ctx: GenCtx): Goal[] {
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

function makeGoals(ctx: GenCtx): Goal[] {
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

const KPI_SEEDS: readonly KpiSeed[] = [
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

function makeKpis(ctx: GenCtx): Kpi[] {
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

const TASK_SEEDS: ReadonlyArray<[string, string, Task['priority'], Task['energy'], number]> = [
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

function makeTasks(ctx: GenCtx): Task[] {
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

function makeRoadmap(ctx: GenCtx): RoadmapItem[] {
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

/* ----------------------------------------------------------- automations -- */

function steps(ctx: GenCtx, seed: string, specs: ReadonlyArray<[string, string, boolean]>): AutomationStep[] {
  return specs.map(([label, specialistId, external], i) => ({
    id: makeRecordId('step', `${ctx.companyId}:${seed}:${i}`),
    label,
    specialistId,
    external,
  }));
}

function makeAutomations(ctx: GenCtx): Automation[] {
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

function makeDocs(ctx: GenCtx): KnowledgeDoc[] {
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

/* ------------------------------------------------------------------ crm --- */

function makeContacts(ctx: GenCtx): Contact[] {
  const { rng, now, draft } = ctx;
  const seeds: ReadonlyArray<[string, string, string, Contact['stage']]> = [
    ['A. Brunner', 'Regional developer', 'Head of projects', 'proposal'],
    ['M. Keller', 'Facility group', 'Operations director', 'qualified'],
    ['S. Frei', 'Architecture practice', 'Partner', 'lead'],
    ['R. Odermatt', 'Municipal office', 'Procurement', 'qualified'],
    ['L. Bianchi', 'Property manager', 'Owner', 'won'],
    ['T. Wyss', 'General contractor', 'Site lead', 'lost'],
    ['N. Achermann', 'Private client', '—', 'dormant'],
  ];
  return seeds.map(([name, organisation, role, stage], i) => ({
    ...base(ctx, 'contact', `${i}:${name}`),
    name,
    organisation,
    role,
    stage,
    value: money(rng.int(4_000, 90_000) * 100, draft.baseCurrency),
    lastTouchAt: iso(addDays(now, -rng.int(2, 60))),
    nextTouchAt:
      stage === 'won' || stage === 'lost' ? undefined : iso(addDays(now, rng.int(-6, 18))),
    notes: '',
  }));
}

/* -------------------------------------------------------------- finance --- */

const EXPENSE_CATEGORIES = [
  'Salaries',
  'Subcontractors',
  'Tools & software',
  'Equipment',
  'Insurance',
  'Marketing',
  'Office & admin',
  'Travel',
];

function makeFinance(ctx: GenCtx): FinanceEntry[] {
  const { rng, now, draft } = ctx;
  const entries: FinanceEntry[] = [];
  for (let monthsAgo = 8; monthsAgo >= -3; monthsAgo -= 1) {
    const monthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, Math.min(15, 28)),
    );
    const future = monthsAgo < 0;
    const confidence: FinanceEntry['confidence'] = future
      ? 'forecast'
      : monthsAgo === 0
        ? 'committed'
        : 'actual';

    const invoiceCount = rng.int(2, 5);
    for (let k = 0; k < invoiceCount; k += 1) {
      entries.push({
        ...base(ctx, 'fin', `in:${monthsAgo}:${k}`),
        date: dayOnly(new Date(monthDate.getTime() + k * 86_400_000 * 2)),
        direction: 'in',
        amount: money(rng.int(3_500, 26_000) * 100, draft.baseCurrency),
        category: rng.pick(['Project delivery', 'Retainer', 'Consulting', 'Maintenance']),
        label: `Invoice ${String(1000 + monthsAgo * 10 + k)}`,
        confidence,
        recurring: rng.bool(0.25),
        simulated: true,
      });
    }
    for (const category of rng.sample(EXPENSE_CATEGORIES, rng.int(4, 6))) {
      entries.push({
        ...base(ctx, 'fin', `out:${monthsAgo}:${category}`),
        date: dayOnly(new Date(monthDate.getTime() + 86_400_000)),
        direction: 'out',
        amount: money(rng.int(300, 14_000) * 100, draft.baseCurrency),
        category,
        label: category,
        confidence,
        recurring: ['Salaries', 'Insurance', 'Tools & software'].includes(category),
        simulated: true,
      });
    }
  }
  return entries;
}

/* ----------------------------------------------------------------- risks -- */

function makeRisks(ctx: GenCtx): RiskItem[] {
  const seeds: ReadonlyArray<[string, string, RiskItem['severity'], RiskItem['kind'], string, string]> = [
    [
      'Revenue concentrated in too few clients',
      'A single client leaving would take the month with it.',
      'high',
      'risk',
      'sales',
      'Hold no client above 30% of monthly revenue; keep two conversations warm per active client.',
    ],
    [
      'Founder is in every delivery',
      'Nothing ships without one person, so nothing scales and nothing rests.',
      'high',
      'bottleneck',
      'operations',
      'Document the delivery SOP, then hand over one full delivery end to end.',
    ],
    [
      'Quoting is manual and inconsistent',
      'Prices vary by mood and memory, so margin is unpredictable.',
      'medium',
      'bottleneck',
      'finance',
      'Codify the pricing model, then automate the first-pass quote.',
    ],
    [
      'No written record of why decisions were made',
      'The same debates get re-run every quarter.',
      'medium',
      'risk',
      'strategy',
      'Record decisions as they happen; the Knowledge Base is the default place.',
    ],
    [
      'Marketing depends on referrals',
      'Referrals are a gift, not a channel, and they stop without warning.',
      'medium',
      'risk',
      'marketing',
      'Prove one repeatable channel before the referral flow softens.',
    ],
  ];
  return seeds.map(([label, detail, severity, kind, capabilityId, mitigation], i) => ({
    ...base(ctx, 'risk', `${i}:${label}`),
    label,
    detail,
    severity,
    kind,
    capabilityId,
    mitigation,
  }));
}

/* ----------------------------------------------------------- suggestions -- */

function makeSuggestions(ctx: GenCtx): Suggestion[] {
  const { rng, draft } = ctx;
  const seeds: ReadonlyArray<[string, string, string, Suggestion['impact'], Suggestion['effort'], string[]]> = [
    [
      'Put a price on the site',
      'Unpriced offers filter out exactly the buyers who are ready. A visible starting price removes a whole round of qualification.',
      'sales',
      'high',
      'low',
      ['Pipeline shows 4 leads stalled before a quote', 'Qualification checklist requires a named budget'],
    ],
    [
      'Hand over one delivery completely',
      'The founder appears in every delivery record. One clean handover proves the SOP and buys back the week.',
      'operations',
      'high',
      'medium',
      ['Bottleneck: founder in every delivery', 'Delivery SOP (v1) exists but is untested by anyone else'],
    ],
    [
      'Arm the month-end close pack',
      'It is drafted and would return roughly two hours a month. It only touches internal data.',
      'automation',
      'medium',
      'low',
      ['Automation "Month-end close pack" is in draft', 'Estimated 120 minutes saved per run'],
    ],
    [
      'Pick the beachhead and say no to the rest',
      `${draft.name} is aimed at two audiences at once, which halves the strength of every message.`,
      'strategy',
      'high',
      'medium',
      ['Company DNA names 2 target segments', 'Goal "Decide the first beachhead segment" is still active'],
    ],
    [
      'Write down three pieces of proof-of-work',
      'Evidence converts better than claims, and it is the cheapest content this company can make.',
      'marketing',
      'medium',
      'medium',
      ['No published proof-of-work content yet', 'Brand guidelines forbid unevidenced claims'],
    ],
  ];
  return seeds.map(([title, rationale, capabilityId, impact, effort, evidence], i) => {
    const specialists = specialistsForCapability(capabilityId);
    const specialist = specialists[0]?.id ?? 'chief-of-staff';
    return {
      ...base(ctx, 'sug', `${i}:${title}`),
      title,
      rationale,
      capabilityId,
      specialistId: specialist,
      impact,
      effort,
      confidence: round(rng.float(0.55, 0.92), 2),
      status: 'open' as const,
      evidence,
      simulated: true,
    };
  });
}

/* ---------------------------------------------------------------- memory -- */

function makeMemory(ctx: GenCtx): MemoryRecord[] {
  const { draft } = ctx;
  const seeds: ReadonlyArray<[MemoryRecord['kind'], string, string]> = [
    ['fact', `${draft.name} operates in ${draft.industry}.`, 'strategy'],
    ['fact', `Business model: ${draft.businessModel}`, 'finance'],
    ['decision', 'Capabilities are granted to this company by default; none were disabled at creation.', 'executive'],
    ['preference', 'Prefers evidence and specifics over narrative in every report.', 'executive'],
    ['pattern', 'Work is defined in two-week slices; anything longer gets broken down.', 'operations'],
    ['lesson', 'Unpriced offers stall in the pipeline before they reach a quote.', 'sales'],
  ];
  return seeds.map(([kind, text, capabilityId], i) => ({
    ...base(ctx, 'mem', `${i}:${text}`),
    kind,
    text,
    capabilityId,
    strength: kind === 'fact' ? 0.9 : 0.6,
    tags: [capabilityId],
    source: 'assistant' as const,
    useCount: 0,
  }));
}

/* -------------------------------------------------------------- creative -- */

function makeCreative(ctx: GenCtx): { briefs: CreativeBrief[]; assets: CreativeAsset[] } {
  const { draft } = ctx;
  const briefs: CreativeBrief[] = [
    {
      ...base(ctx, 'brief', 'launch'),
      title: 'Launch announcement',
      objective: `Introduce ${draft.name} to the beachhead segment with evidence, not adjectives.`,
      audience: 'Owner-operators and operations leads in the target region.',
      keyMessage: draft.mission,
      mustInclude: ['A real piece of finished work', 'A named starting price', 'One way to start a conversation'],
      mustAvoid: ['Superlatives', 'Stock imagery', 'Claims we cannot show'],
      formats: ['social-post', 'marketing-asset', 'image'],
      channel: 'LinkedIn + site',
    },
    {
      ...base(ctx, 'brief', 'proof'),
      title: 'Proof-of-work series',
      objective: 'Show the work in enough detail that a sceptical buyer can judge quality.',
      audience: 'Technical and procurement buyers who distrust marketing.',
      keyMessage: 'Here is exactly what we did, how, and what it cost.',
      mustInclude: ['Before and after', 'Method', 'What went wrong and how it was handled'],
      mustAvoid: ['Hiding the difficult parts'],
      formats: ['image', 'social-post', 'presentation'],
      channel: 'Site + newsletter',
    },
  ];

  const assetSeeds: ReadonlyArray<[string, CreativeAsset['kind'], CreativeAsset['aspect'], CreativeAsset['status']]> = [
    ['Primary wordmark', 'logo', '1:1', 'draft'],
    ['Launch hero image', 'image', '16:9', 'brief'],
    ['Proof-of-work carousel', 'social-post', '4:5', 'brief'],
    ['Capabilities one-pager', 'presentation', '16:9', 'draft'],
    ['Site hero composition', 'ui-design', '16:9', 'brief'],
  ];

  const assets: CreativeAsset[] = assetSeeds.map(([title, kind, aspect, status], i) => ({
    ...base(ctx, 'asset', `${i}:${title}`),
    title,
    kind,
    status,
    briefId: briefs[i % briefs.length]?.id,
    prompt: `${title} for ${draft.name}. Voice: ${draft.name} sounds assured and specific. No stock imagery.`,
    previewSeed: `${ctx.companyId}:${slugify(title)}`,
    aspect,
    generatedBy: 'designer',
    simulated: true,
  }));

  return { briefs, assets };
}

/* -------------------------------------------------------------- assembly -- */

export interface GeneratedCompany {
  readonly company: Company;
  readonly data: ScopeData;
}

/**
 * Turn a founder's short draft into a complete company headquarters.
 *
 * Deterministic: the same draft always produces the same headquarters, which is
 * what makes this testable and what stops a reload from silently reshuffling a
 * founder's world.
 */
export interface GenerateOptions {
  /**
   * A real company starts from the truth: structure, DNA scaffold and the
   * founder's own goals — and not one invented record. The populated mode
   * exists to make the product legible in one glance; the clean slate exists
   * so a founder can run their actual business without fiction in the ledger.
   */
  readonly cleanSlate?: boolean;
}

export function generateCompanyWorkspace(draft: CompanyDraft, now: Date = new Date(), options: GenerateOptions = {}): GeneratedCompany {
  const companyId = makeId(draft.name, `${draft.name}:${draft.industry}`);
  const ctx: GenCtx = { rng: createRng(companyId), companyId, now, draft };

  const company: Company = {
    id: companyId,
    name: draft.name,
    shortName: draft.name.split(/\s+/)[0] ?? draft.name,
    description: draft.description,
    industry: draft.industry,
    stage: draft.stage,
    createdAt: iso(now),
    updatedAt: iso(now),
    baseCurrency: draft.baseCurrency,
    dna: makeDna(ctx),
    brand: makeBrand(ctx),
    expansion: [
      {
        id: makeId('home market', `${companyId}:exp0`),
        market: 'Home region',
        rationale: 'Prove the model where reputation travels fastest and delivery is cheapest.',
        status: 'live',
        horizon: 'Now',
      },
      {
        id: makeId('adjacent region', `${companyId}:exp1`),
        market: 'Adjacent region',
        rationale: 'Same language, same regulations, no new operating model required.',
        status: 'considering',
        horizon: 'Next 12 months',
      },
    ],
    disabledCapabilityIds: [],
    // The badge this flag drives reads "Sample workspace". A clean slate holds
    // the founder's real company — generated scaffolding, but no sample data.
    generated: !options.cleanSlate,
  };

  if (options.cleanSlate) {
    return { company, data: { ...emptyScopeData(), goals: founderGoals(ctx) } };
  }

  const { briefs, assets } = makeCreative(ctx);

  const data: ScopeData = {
    ...emptyScopeData(),
    goals: makeGoals(ctx),
    kpis: makeKpis(ctx),
    tasks: makeTasks(ctx),
    roadmap: makeRoadmap(ctx),
    automations: makeAutomations(ctx),
    docs: makeDocs(ctx),
    contacts: makeContacts(ctx),
    finance: makeFinance(ctx),
    risks: makeRisks(ctx),
    suggestions: makeSuggestions(ctx),
    memory: makeMemory(ctx),
    briefs,
    assets,
  };

  return { company, data };
}

/** Capabilities a freshly created company receives — every one that applies. */
export function grantedCapabilityIds(): string[] {
  return capabilitiesFor('company').map((c) => c.id);
}

/** Used by the create flow's preview: what the founder is about to receive. */
export function generationSummary(): Array<{ label: string; detail: string }> {
  const caps = capabilitiesFor('company');
  return [
    { label: `${caps.length} capabilities`, detail: caps.map((c) => c.name).join(' · ') },
    { label: 'Company DNA', detail: 'Mission, vision, values, audience, competitors, strategy' },
    { label: 'Brand DNA', detail: 'Voice, tone, palette, typography, imagery, guardrails' },
    { label: `${KPI_SEEDS.length} KPIs`, detail: 'Seeded across finance, growth, delivery and strategy' },
    { label: `${TASK_SEEDS.length} opening tasks`, detail: 'The work a company this age actually has' },
    { label: 'Ledger', detail: '12 months of entries — 9 actual, 3 forecast' },
    { label: 'Automations', detail: '6 templates, three armed, none touching the outside world' },
    { label: 'AI team', detail: `${CAPABILITIES.length} capability platforms staffed by specialists` },
  ];
}
