/**
 * The local reasoning engine.
 *
 * When no model provider is configured, OmniOS does not fake a conversation. It
 * runs this instead: real analysis over the founder's actual records, written up
 * deterministically. The numbers in every answer below are read from the store,
 * not invented — which is why the answers are useful before a single API key
 * exists, and why the same code path stays valuable afterwards as the grounding
 * layer beneath a real model.
 */

import type { DateOnly, Task } from '@/lib/domain';
import { EMPTY, daysBetween, formatDate, formatDurationMinutes, formatKpiValue, formatMinorAmount, pluralise } from '@/lib/format';
import { deepWorkBudgetMinutes, energyLabel, energyOf } from '@/lib/personal/energy';
import type { AssistantContext, Origin } from './context';
import {
  automationsOf,
  calendarOf,
  contactsOf,
  financeOf,
  goalsOf,
  habitsOf,
  healthOf,
  kpisOf,
  learningOf,
  lifeAdminOf,
  memoryOf,
  relationshipsOf,
  risksOf,
  suggestionsOf,
  tasksOf,
} from './context';
import type { RoutingResult } from './router';
import type { ContextReferenceInput } from './types';

export interface Composition {
  readonly summary: string;
  readonly body: string;
  readonly references: readonly ContextReferenceInput[];
  readonly outputs: ReadonlyMap<string, string>;
}

const PRIORITY_WEIGHT: Record<Task['priority'], number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
const ENERGY_MINUTES: Record<Task['energy'], number> = { light: 15, moderate: 45, deep: 110 };

/* ------------------------------------------------------------- helpers ---- */

function ref(kind: string, o: Origin<{ id: string }>, label: string): ContextReferenceInput {
  return { kind, id: o.item.id, label, scopeKey: o.scopeKey };
}

function latestHealth(ctx: AssistantContext) {
  const days = healthOf(ctx)
    .filter((d) => d.item.sleepHours !== undefined)
    .sort((a, b) => (a.item.date < b.item.date ? 1 : -1));
  return days[0];
}

function energyToday(ctx: AssistantContext): { score: number | null; label: string; budget: number | null } {
  const latest = latestHealth(ctx);
  const score = energyOf(latest?.item);
  return { score, label: energyLabel(score), budget: deepWorkBudgetMinutes(score) };
}

function openTasks(ctx: AssistantContext): Array<Origin<Task>> {
  return tasksOf(ctx)
    .filter((t) => t.item.status !== 'done')
    .sort((a, b) => {
      const p = PRIORITY_WEIGHT[a.item.priority] - PRIORITY_WEIGHT[b.item.priority];
      if (p !== 0) return p;
      const aDue = a.item.dueDate ?? '9999-12-31';
      const bDue = b.item.dueDate ?? '9999-12-31';
      return aDue < bDue ? -1 : aDue > bDue ? 1 : 0;
    });
}

function isOverdue(due: DateOnly | undefined, now: Date): boolean {
  return due !== undefined && new Date(due).getTime() < now.getTime();
}

interface Position {
  readonly inMinor: number;
  readonly outMinor: number;
  readonly netMinor: number;
  readonly currency: 'CHF' | 'EUR' | 'USD' | 'GBP';
  readonly months: number;
}

function position(ctx: AssistantContext, monthsBack = 3): Position {
  const cutoff = new Date(ctx.now.getTime() - monthsBack * 30 * 86_400_000).toISOString().slice(0, 10);
  const entries = financeOf(ctx).filter(
    (e) => e.item.date >= cutoff && e.item.confidence !== 'forecast',
  );
  let inMinor = 0;
  let outMinor = 0;
  let currency: Position['currency'] = 'CHF';
  for (const { item } of entries) {
    currency = item.amount.currency;
    if (item.direction === 'in') inMinor += item.amount.amount;
    else outMinor += item.amount.amount;
  }
  return { inMinor, outMinor, netMinor: inMinor - outMinor, currency, months: monthsBack };
}

function bullet(lines: readonly string[]): string {
  return lines.map((l) => `• ${l}`).join('\n');
}

function section(heading: string, body: string): string {
  return `${heading}\n${body}`;
}

/**
 * Join answer blocks with a blank line between them.
 *
 * Not `.filter(Boolean).join('\n')` — an intentional blank separator is falsy,
 * so that idiom silently collapsed every section heading onto the line above it.
 */
function blocks(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n');
}

/* ---------------------------------------------------------- composers ----- */

type Composer = (ctx: AssistantContext, prompt: string) => Composition;

/** Chief of Staff: what to do next, given everything. */
const composeExecutive: Composer = (ctx) => {
  const { score, label, budget } = energyToday(ctx);
  const tasks = openTasks(ctx);
  const overdue = tasks.filter((t) => isOverdue(t.item.dueDate, ctx.now));
  const blocked = tasks.filter((t) => t.item.status === 'blocked');
  const references: ContextReferenceInput[] = [];

  // Fill the day against the energy budget rather than listing everything open.
  const capacity = budget ?? 180;
  const picked: Array<Origin<Task>> = [];
  let spent = 0;
  for (const t of tasks) {
    const cost = t.item.estimateMinutes ?? ENERGY_MINUTES[t.item.energy];
    if (t.item.status === 'blocked') continue;
    if (spent + cost > capacity && picked.length >= 1) continue;
    picked.push(t);
    spent += cost;
    if (picked.length >= 4) break;
  }
  for (const t of picked) references.push(ref('task', t, t.item.title));

  const energyLine =
    score === null
      ? 'Energy is unknown today — nothing recent was logged, so this plan assumes an average day rather than guessing.'
      : `Energy is ${label.toLowerCase()} (${score}/100), which honestly supports about ${formatDurationMinutes(capacity)} of focused work.`;

  const lines = picked.map((t) => {
    const cost = t.item.estimateMinutes ?? ENERGY_MINUTES[t.item.energy];
    const where = ctx.slices.length > 1 ? ` · ${t.spaceLabel}` : '';
    const due = t.item.dueDate ? ` · due ${formatDate(t.item.dueDate)}` : '';
    return `${t.item.title} — ${t.item.priority.toUpperCase()} · ${formatDurationMinutes(cost)}${where}${due}`;
  });

  const tail: string[] = [];
  if (overdue.length) {
    tail.push(
      `${pluralise(overdue.length, 'item is', 'items are')} past their date. The oldest is "${overdue[0]?.item.title}".`,
    );
  }
  if (blocked.length) {
    const first = blocked[0];
    tail.push(
      `${pluralise(blocked.length, 'task is', 'tasks are')} blocked — "${first?.item.title}" is waiting on: ${first?.item.blockedReason ?? 'an unnamed dependency'}.`,
    );
  }
  const overdueRel = relationshipsOf(ctx).filter(
    (r) => r.item.lastContactAt && daysBetween(r.item.lastContactAt, ctx.now) > r.item.cadenceDays,
  );
  if (overdueRel.length) {
    tail.push(
      `${pluralise(overdueRel.length, 'person is', 'people are')} past the cadence you set — starting with ${overdueRel[0]?.item.name}.`,
    );
  }

  const body = blocks([
    energyLine,
    section('What I would do today', lines.length ? bullet(lines) : '• Nothing is open. That is allowed.'),
    tail.length ? section('Worth knowing', bullet(tail)) : null,
  ]);

  return {
    summary: `Ranked ${tasks.length} open items against today's energy and picked ${picked.length}.`,
    body,
    references,
    outputs: new Map([
      ['chief-of-staff', `Sequenced ${picked.length} items inside a ${formatDurationMinutes(capacity)} budget.`],
      ['health', score === null ? 'No recent recovery data to read.' : `Recovery reads ${label.toLowerCase()} at ${score}/100.`],
      ['project-manager', blocked.length ? `${blocked.length} blocked item(s) flagged.` : 'Nothing blocked.'],
    ]),
  };
};

/** Finance Lead: position, burn, and where the money actually goes. */
const composeFinance: Composer = (ctx) => {
  const pos = position(ctx, 3);
  const references: ContextReferenceInput[] = [];

  const byCategory = new Map<string, number>();
  for (const e of financeOf(ctx)) {
    if (e.item.direction !== 'out' || e.item.confidence === 'forecast') continue;
    byCategory.set(e.item.category, (byCategory.get(e.item.category) ?? 0) + e.item.amount.amount);
  }
  const topCosts = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const monthlyBurn = pos.outMinor / pos.months;
  const monthlyIn = pos.inMinor / pos.months;
  const runwayMonths = monthlyBurn > 0 ? pos.netMinor / monthlyBurn : null;

  const financeKpis = kpisOf(ctx).filter((k) => k.item.capabilityId === 'finance');
  for (const k of financeKpis.slice(0, 3)) references.push(ref('kpi', k, k.item.label));

  const lines = [
    `In, last ${pos.months} months: ${formatMinorAmount(pos.inMinor, pos.currency)}`,
    `Out, last ${pos.months} months: ${formatMinorAmount(pos.outMinor, pos.currency)}`,
    `Net: ${formatMinorAmount(pos.netMinor, pos.currency)} (${formatMinorAmount(Math.round(monthlyIn - monthlyBurn), pos.currency)} per month)`,
  ];

  const costLines = topCosts.map(
    ([category, amount]) =>
      `${category} — ${formatMinorAmount(amount, pos.currency)} (${Math.round((amount / Math.max(1, pos.outMinor)) * 100)}% of spend)`,
  );

  const verdict =
    pos.netMinor >= 0
      ? runwayMonths !== null && runwayMonths < 6
        ? 'Positive, but thin. A single bad month would erase the buffer.'
        : 'Positive and holding. The buffer is real.'
      : 'Negative over the period. This is the number to fix before anything else gets funded.';

  const body = blocks([
    section(`Position (actuals only, forecasts excluded)`, bullet(lines)),
    section('Where it goes', costLines.length ? bullet(costLines) : '• No recorded spend.'),
    section('Read', verdict),
  ]);

  return {
    summary: `Reconciled ${pluralise(financeOf(ctx).length, 'ledger entry', 'ledger entries')} across ${pos.months} months.`,
    body,
    references,
    outputs: new Map([
      ['cfo', `Net ${formatMinorAmount(pos.netMinor, pos.currency)} over ${pos.months} months.`],
      ['analyst', topCosts.length ? `Largest cost line: ${topCosts[0]?.[0]}.` : 'No spend to analyse.'],
    ]),
  };
};

/** Performance Coach: recovery, and what it permits. */
const composeHealth: Composer = (ctx) => {
  const days = healthOf(ctx)
    .filter((d) => d.item.sleepHours !== undefined)
    .sort((a, b) => (a.item.date < b.item.date ? 1 : -1));

  if (days.length === 0) {
    return {
      summary: 'No health data recorded.',
      body: 'There is nothing logged yet, so there is nothing honest to say about recovery. Once sleep and HRV are recorded, this becomes the input the weekly plan is built from.',
      references: [],
      outputs: new Map([['health', 'No data available.']]),
    };
  }

  const week = days.slice(0, 7);
  const avgSleep = week.reduce((s, d) => s + (d.item.sleepHours ?? 0), 0) / week.length;
  const energies = week.map((d) => energyOf(d.item)).filter((e): e is number => e !== null);
  const avgEnergy = energies.length ? Math.round(energies.reduce((s, e) => s + e, 0) / energies.length) : null;
  const low = week.filter((d) => (energyOf(d.item) ?? 100) < 55).length;
  const trained = week.filter((d) => (d.item.workoutMinutes ?? 0) > 0).length;
  const budget = deepWorkBudgetMinutes(avgEnergy);

  const nonNegotiable = ctx.personal.dna.nonNegotiables.find((n) => /sleep/i.test(n));
  const breach = nonNegotiable && avgSleep < 7;

  const body = blocks([
    section(
      'Last seven days',
      bullet([
        `Average sleep: ${avgSleep.toFixed(1)}h`,
        `Average energy: ${avgEnergy === null ? '—' : `${avgEnergy}/100 (${energyLabel(avgEnergy).toLowerCase()})`}`,
        `Days below 55 energy: ${low}`,
        `Training sessions: ${trained}`,
      ]),
    ),
    section(
      'What that permits',
      budget === null
        ? 'Not enough signal to set a deep-work budget.'
        : `About ${formatDurationMinutes(budget)} of deep work per day. Planning above that borrows from next week.`,
    ),
    breach
      ? `This breaches one of your own non-negotiables: "${nonNegotiable}". It is the first thing to fix, because every other number here is downstream of it.`
      : null,
  ]);

  return {
    summary: `Read ${week.length} days of recovery data.`,
    body,
    references: week.slice(0, 3).map((d) => ref('health', d, `Health ${d.item.date}`)),
    outputs: new Map([
      ['health', `Seven-day average energy ${avgEnergy ?? '—'}, sleep ${avgSleep.toFixed(1)}h.`],
      ['chief-of-staff', budget ? `Deep-work budget set to ${formatDurationMinutes(budget)}/day.` : 'Budget unset.'],
    ]),
  };
};

/** Life Architect: the people and habits that have no deadline. */
const composePersonal: Composer = (ctx) => {
  const rels = relationshipsOf(ctx);
  const overdue = rels
    .filter((r) => r.item.lastContactAt && daysBetween(r.item.lastContactAt, ctx.now) > r.item.cadenceDays)
    .sort((a, b) => daysBetween(b.item.lastContactAt ?? '', ctx.now) - daysBetween(a.item.lastContactAt ?? '', ctx.now));

  const habits = habitsOf(ctx);
  const struggling = habits
    .map((h) => {
      const recent = h.item.completions.filter((d) => daysBetween(d, ctx.now) <= 28).length;
      const expected = h.item.targetPerWeek * 4;
      return { h, adherence: expected > 0 ? recent / expected : 1 };
    })
    .filter((x) => x.adherence < 0.7)
    .sort((a, b) => a.adherence - b.adherence);

  const admin = lifeAdminOf(ctx)
    .filter((a) => a.item.status !== 'done')
    .sort((a, b) => (a.item.dueDate ?? '9999') < (b.item.dueDate ?? '9999') ? -1 : 1);

  const learn = learningOf(ctx).filter((l) => l.item.status === 'active');

  const body = blocks([
    section(
      'People past their cadence',
      overdue.length
        ? bullet(
            overdue
              .slice(0, 4)
              .map(
                (r) =>
                  `${r.item.name} — ${daysBetween(r.item.lastContactAt ?? '', ctx.now)} days (you set ${r.item.cadenceDays})${r.item.nextIntent ? ` · ${r.item.nextIntent}` : ''}`,
              ),
          )
        : '• Everyone is within the cadence you set.',
    ),
    section(
      'Habits slipping',
      struggling.length
        ? bullet(struggling.slice(0, 3).map((x) => `${x.h.item.name} — ${Math.round(x.adherence * 100)}% of target`))
        : '• Nothing below 70% adherence.',
    ),
    section(
      'Next up',
      bullet(
        [
          admin[0] ? `${admin[0].item.title} — due ${formatDate(admin[0].item.dueDate)}` : null,
          learn[0] ? `${learn[0].item.title} — ${Math.round(learn[0].item.progress * 100)}% through` : null,
        ].filter((x): x is string => x !== null),
      ) || '• Nothing pending.',
    ),
  ]);

  return {
    summary: `Checked ${rels.length} relationships, ${habits.length} habits and ${admin.length} open life items.`,
    body,
    references: overdue.slice(0, 3).map((r) => ref('relationship', r, r.item.name)),
    outputs: new Map([
      ['life-coach', `${overdue.length} people overdue, ${struggling.length} habits slipping.`],
      ['chief-of-staff', 'None of this is urgent, which is exactly why it slips.'],
    ]),
  };
};

/** Strategist: are the goals still the plan, and what would break them. */
const composeStrategy: Composer = (ctx) => {
  const goals = goalsOf(ctx);
  const atRisk = goals.filter((g) => g.item.status === 'at-risk' || g.item.status === 'off-track');
  const risks = risksOf(ctx).sort((a, b) => severityRank(b.item.severity) - severityRank(a.item.severity));

  const body = blocks([
    section(
      'Goals',
      bullet(
        goals
          .slice(0, 5)
          .map(
            (g) =>
              `${g.item.title} — ${Math.round(g.item.progress * 100)}% · ${g.item.status}${ctx.slices.length > 1 ? ` · ${g.spaceLabel}` : ''}`,
          ),
      ) || '• No goals set.',
    ),
    section(
      'What would break the plan',
      bullet(risks.slice(0, 3).map((r) => `${r.item.label} (${r.item.severity}) — ${r.item.mitigation ?? 'no mitigation recorded'}`)) ||
        '• No risks recorded.',
    ),
    section(
      'Read',
      atRisk.length
        ? `${pluralise(atRisk.length, 'goal is', 'goals are')} not on track. The honest move is to cut one rather than run all of them at 60%.`
        : 'Everything tracked is on course. The risk register is where the attention belongs.',
    ),
  ]);

  return {
    summary: `Reviewed ${goals.length} goals and ${risks.length} risks.`,
    body,
    references: [
      ...goals.slice(0, 2).map((g) => ref('goal', g, g.item.title)),
      ...risks.slice(0, 2).map((r) => ref('risk', r, r.item.label)),
    ],
    outputs: new Map([
      ['strategist', atRisk.length ? `${atRisk.length} goals off track.` : 'Goals on track.'],
      ['analyst', `${risks.length} risks on the register.`],
    ]),
  };
};

const severityRank = (s: string): number => ({ critical: 4, high: 3, medium: 2, low: 1 })[s] ?? 0;

/** Sales / Marketing: pipeline and where attention is leaking. */
const composeGrowth: Composer = (ctx) => {
  const contacts = contactsOf(ctx);
  const active = contacts.filter((c) => !['won', 'lost', 'dormant'].includes(c.item.stage));
  const stale = active.filter(
    (c) => c.item.nextTouchAt && new Date(c.item.nextTouchAt).getTime() < ctx.now.getTime(),
  );
  const pipelineMinor = active.reduce((sum, c) => sum + (c.item.value?.amount ?? 0), 0);
  const currency = active[0]?.item.value?.currency ?? 'CHF';
  const growthKpis = kpisOf(ctx).filter((k) => ['marketing', 'sales'].includes(k.item.capabilityId));

  const body = blocks([
    section(
      'Pipeline',
      bullet([
        `${pluralise(active.length, 'open conversation')} worth ${formatMinorAmount(pipelineMinor, currency)}`,
        `${pluralise(stale.length, 'is', 'are')} past the follow-up date you set`,
        `${pluralise(contacts.filter((c) => c.item.stage === 'won').length, 'deal')} won, ${contacts.filter((c) => c.item.stage === 'lost').length} lost`,
      ]),
    ),
    section(
      'Metrics',
      // A KPI armed but never measured has nothing to say — an em dash, never a
      // zero the founder might mistake for a measurement. Everything with a
      // value goes through the one formatter money and percentages share.
      bullet(
        growthKpis
          .slice(0, 4)
          .map(
            (k) =>
              `${k.item.label}: ${
                k.item.series.length <= 1 && k.item.value === 0 ? `${EMPTY} no data yet` : formatKpiValue(k.item)
              }`,
          ),
      ) || '• No growth metrics recorded.',
    ),
    section(
      'Read',
      stale.length
        ? `The leak is follow-up, not lead generation: ${stale.length} of ${active.length} open conversations are already past their date. ${stale[0]?.item.name} is the oldest.`
        : 'Follow-up is current. The constraint is upstream — more qualified conversations, not better chasing.',
    ),
  ]);

  return {
    summary: `Read ${contacts.length} contacts and ${growthKpis.length} growth metrics.`,
    body,
    references: stale.slice(0, 3).map((c) => ref('contact', c, c.item.name)),
    outputs: new Map([
      ['sales', `${active.length} open, ${stale.length} stale.`],
      ['marketer', 'Growth metrics read from this space only.'],
    ]),
  };
};

/** Operations / Automation: where work queues and what could stop being manual. */
const composeOperations: Composer = (ctx) => {
  const autos = automationsOf(ctx);
  const armed = autos.filter((a) => a.item.status === 'armed');
  const draft = autos.filter((a) => a.item.status === 'draft');
  const savedPerMonth = armed.reduce((s, a) => s + a.item.minutesSavedPerRun * a.item.runsThisMonth, 0);
  const potential = draft.reduce((s, a) => s + a.item.minutesSavedPerRun * 4, 0);
  const bottlenecks = risksOf(ctx).filter((r) => r.item.kind === 'bottleneck');

  const body = blocks([
    section(
      'Automation',
      bullet([
        `${armed.length} armed, returning about ${formatDurationMinutes(savedPerMonth)} this month`,
        `${draft.length} drafted but not armed — roughly ${formatDurationMinutes(potential)} a month unclaimed`,
        `${autos.filter((a) => a.item.requiresApproval).length} would touch something outside OmniOS and stop for approval`,
      ]),
    ),
    section(
      'Where work queues',
      bullet(bottlenecks.slice(0, 3).map((b) => `${b.item.label} — ${b.item.mitigation ?? 'no mitigation recorded'}`)) ||
        '• No bottlenecks recorded.',
    ),
    section(
      'Read',
      draft.length
        ? `The cheapest win is arming "${draft[0]?.item.name}" — it is already written and touches nothing external.`
        : 'Everything drafted is armed. The next gain comes from removing a bottleneck, not adding an automation.',
    ),
  ]);

  return {
    summary: `Reviewed ${autos.length} automations and ${bottlenecks.length} bottlenecks.`,
    body,
    references: draft.slice(0, 2).map((a) => ref('automation', a, a.item.name)),
    outputs: new Map([
      ['operator', `${bottlenecks.length} bottleneck(s) on the register.`],
      ['automation', `${draft.length} automations ready to arm.`],
    ]),
  };
};

/** Development: what is moving and what is stuck. */
const composeDevelopment: Composer = (ctx) => {
  const tasks = tasksOf(ctx).filter((t) => t.item.capabilityId === 'development');
  const blocked = tasks.filter((t) => t.item.status === 'blocked');
  const active = tasks.filter((t) => t.item.status === 'active');
  const roadmap = ctx.slices.flatMap((s) =>
    s.data.roadmap.map((r) => ({ item: r, spaceLabel: s.label, scopeKey: s.scopeKey, spaceKind: s.spaceKind })),
  );
  const building = roadmap.filter((r) => r.item.stage === 'building');

  const body = blocks([
    section(
      'In flight',
      bullet([
        ...building.slice(0, 3).map((r) => `${r.item.title} — building · confidence ${Math.round(r.item.confidence * 100)}%`),
        ...active.slice(0, 3).map((t) => `${t.item.title} — active`),
      ]) || '• Nothing in flight.',
    ),
    section(
      'Stuck',
      bullet(blocked.map((t) => `${t.item.title} — ${t.item.blockedReason ?? 'reason not recorded'}`)) ||
        '• Nothing blocked.',
    ),
    section(
      'Read',
      building.length > 2
        ? `${building.length} things are "building" at once. Finishing one beats advancing three.`
        : 'Work in progress is at a sane level. Keep it there.',
    ),
  ]);

  return {
    summary: `Read ${tasks.length} engineering tasks and ${roadmap.length} roadmap items.`,
    body,
    references: blocked.slice(0, 3).map((t) => ref('task', t, t.item.title)),
    outputs: new Map([
      ['engineer', `${active.length} active, ${blocked.length} blocked.`],
      ['project-manager', building.length > 2 ? 'Too much in flight.' : 'WIP under control.'],
    ]),
  };
};

/** Fallback: orient in the space rather than produce nothing. */
const composeGeneral: Composer = (ctx, prompt) => {
  const tasks = openTasks(ctx);
  const sugg = suggestionsOf(ctx).filter((s) => s.item.status === 'open');
  const mem = memoryOf(ctx).filter((m) => m.item.kind === 'preference' || m.item.kind === 'decision');
  const cal = calendarOf(ctx).filter((c) => c.item.date === ctx.now.toISOString().slice(0, 10));

  const body = blocks([
    `I do not have a specialist that clearly owns "${prompt.trim()}", so here is where things stand and who would take it if you narrow it.`,
    section(
      'State',
      bullet([
        `${pluralise(tasks.length, 'open item')}${tasks[0] ? `, top of the list: "${tasks[0].item.title}"` : ''}`,
        `${pluralise(sugg.length, 'open recommendation')}`,
        `${pluralise(cal.length, 'block')} on the calendar today`,
      ]),
    ),
    mem.length
      ? section('Working from what I know about you', bullet(mem.slice(0, 3).map((m) => m.item.text)))
      : null,
  ]);

  return {
    summary: 'No clear specialist owner — orienting instead of guessing.',
    body,
    references: mem.slice(0, 2).map((m) => ref('memory', m, m.item.text.slice(0, 48))),
    outputs: new Map([['chief-of-staff', 'Took it directly; no specialist clearly owned it.']]),
  };
};

const BY_DOMAIN: Partial<Record<string, Composer>> = {
  executive: composeExecutive,
  finance: composeFinance,
  health: composeHealth,
  personal: composePersonal,
  strategy: composeStrategy,
  research: composeStrategy,
  sales: composeGrowth,
  marketing: composeGrowth,
  social: composeGrowth,
  branding: composeGrowth,
  operations: composeOperations,
  automation: composeOperations,
  'project-management': composeOperations,
  development: composeDevelopment,
  design: composeDevelopment,
  data: composeFinance,
};

export function compose(ctx: AssistantContext, prompt: string, routing: RoutingResult): Composition {
  // Zero matches means the router fell back to the Chief of Staff because nobody
  // claimed the request — not because the Chief of Staff was the right answer.
  // Replying with today's plan to a question it did not understand would be a
  // non-sequitur, so say so and orient instead.
  if (routing.scores.length === 0) return composeGeneral(ctx, prompt);
  const composer = BY_DOMAIN[routing.lead.domain] ?? composeGeneral;
  return composer(ctx, prompt);
}
