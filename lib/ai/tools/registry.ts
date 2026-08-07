/**
 * The tool catalogue.
 *
 * Data only — no store access, no `server-only`, no side effects. That is what
 * lets the same list drive the command palette, the approval sheet, a model's
 * function schema and the tests, without any of them reaching for an executor.
 *
 * Two rules shape every entry:
 *
 * 1. The `risk` tier is the whole gate. `write` touches this workspace and runs.
 *    `destructive` and `external` stop and wait for a recorded human decision —
 *    see {@link requiresApproval}. A tool that would delete something or leave
 *    the machine is never tiered `write` to make it convenient.
 * 2. `preview` is a promise. It states, in one sentence, exactly what the call
 *    would do, and it is rendered *before* anything happens. Approval without a
 *    preview is theatre, so the preview must survive missing arguments rather
 *    than throwing and leaving the founder approving a blank.
 */

import type { CollectionName } from '@/lib/data/schema';
import type { ToolArgs, ToolDefinition } from '@/lib/domain';
import {
  ASSET_KINDS,
  AUTOMATION_TRIGGERS,
  CRM_STAGES,
  CURRENCIES,
  DOC_KINDS,
  ENERGY_COSTS,
  FINANCE_CONFIDENCE,
  FINANCE_DIRECTIONS,
  GOAL_HORIZONS,
  GOAL_STATUSES,
  HABIT_CADENCES,
  KPI_DIRECTIONS,
  KPI_FORMATS,
  LIFE_ADMIN_KINDS,
  MEMORY_KINDS,
  PRIORITIES,
  RELATIONSHIP_CIRCLES,
  ROADMAP_STAGES,
  SEVERITIES,
  TASK_STATUSES,
} from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import { EMPTY, formatMinorAmount } from '@/lib/format';

/* ------------------------------------------------------- arg accessors ---- */

/** Reading an arg never throws: a preview for half-filled arguments still has to render. */
export function argText(args: ToolArgs, name: string, fallback = ''): string {
  const value = args[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

export function argNumber(args: ToolArgs, name: string): number | undefined {
  const value = args[name];
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  return undefined;
}

export function argFlag(args: ToolArgs, name: string): boolean {
  return args[name] === true;
}

/** A number for prose, or an em dash. Never a fabricated zero. */
function say(value: number | undefined): string {
  return value === undefined ? EMPTY : String(value);
}

const quoted = (args: ToolArgs, name: string, fallback: string): string =>
  `“${argText(args, name, fallback)}”`;

const money = (args: ToolArgs): string => {
  const amount = argNumber(args, 'amountMinor');
  if (amount === undefined) return EMPTY;
  return formatMinorAmount(amount, currencyOf(args));
};

function currencyOf(args: ToolArgs): 'CHF' | 'EUR' | 'USD' | 'GBP' {
  const raw = argText(args, 'currency', 'CHF');
  return (CURRENCIES as readonly string[]).includes(raw)
    ? (raw as 'CHF' | 'EUR' | 'USD' | 'GBP')
    : 'CHF';
}

/* ----------------------------------------------------------- deletion ----- */

/**
 * Collections `delete_record` may touch.
 *
 * Everything append-only is missing on purpose: `toolCalls`, `agentRuns`,
 * `automationRuns`, `messages` and `evolution` are the record of what the system
 * did and what it concluded. A tool that can erase its own audit trail makes
 * every other guarantee here unfalsifiable.
 */
export const DELETABLE_COLLECTIONS = [
  'tasks',
  'goals',
  'kpis',
  'roadmap',
  'automations',
  'docs',
  'contacts',
  'finance',
  'risks',
  'suggestions',
  'notifications',
  'memory',
  'briefs',
  'assets',
  'products',
  'health',
  'habits',
  'relationships',
  'learning',
  'lifeAdmin',
  'calendar',
  'observations',
  'routingHints',
  'specialistScores',
  'customAgents',
] as const satisfies readonly CollectionName[];

export type DeletableCollection = (typeof DELETABLE_COLLECTIONS)[number];

/**
 * Collections `reset_capability_data` clears, all of which carry a `capabilityId`.
 * `evolution` is deliberately absent for the same reason as above.
 */
export const CAPABILITY_SCOPED_COLLECTIONS = [
  'tasks',
  'goals',
  'kpis',
  'roadmap',
  'automations',
  'docs',
  'risks',
  'suggestions',
  'memory',
  'observations',
] as const satisfies readonly CollectionName[];

export type CapabilityScopedCollection = (typeof CAPABILITY_SCOPED_COLLECTIONS)[number];

/** CalendarBlock's kind is an inline union on the record, so it is restated here. */
export const CALENDAR_BLOCK_KINDS = [
  'deep-work',
  'meeting',
  'admin',
  'rest',
  'personal',
  'travel',
] as const;

const BOTH = ['company', 'personal'] as const;
const PERSONAL = ['personal'] as const;

/* --------------------------------------------------------------- tools ---- */

const TOOL_LIST = [
  /* ------------------------------------------------------------ work ------ */
  {
    id: 'create_task',
    label: 'Create a task',
    description:
      'Add a task to a space. Use when the founder describes work that has to happen but does not exist as a record yet.',
    risk: 'write',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: [
      'create a task',
      'add a task',
      'new task',
      'remind me to',
      'i need to',
      'todo',
      'to-do',
      'put it on my list',
      'add to my list',
    ],
    params: [
      { name: 'title', type: 'string', description: 'What needs doing, in the founder’s words.', required: true },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Which capability the work belongs to.',
        required: false,
        enumValues: capabilityIds(),
        default: 'operations',
      },
      { name: 'status', type: 'enum', description: 'Where it starts on the board.', required: false, enumValues: TASK_STATUSES, default: 'next' },
      { name: 'priority', type: 'enum', description: 'p0 is drop-everything.', required: false, enumValues: PRIORITIES, default: 'p2' },
      { name: 'energy', type: 'enum', description: 'How much of the day’s energy budget it costs.', required: false, enumValues: ENERGY_COSTS, default: 'moderate' },
      { name: 'dueDate', type: 'date', description: 'YYYY-MM-DD. Omit when there is no real deadline.', required: false },
      { name: 'estimateMinutes', type: 'number', description: 'Rough size in minutes.', required: false },
      { name: 'notes', type: 'text', description: 'Anything the founder said that the title loses.', required: false },
      { name: 'goalId', type: 'string', description: 'Goal this task serves, if there is one.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Create a ${argText(args, 'priority', 'p2')} task ${quoted(args, 'title', 'untitled')} under ${argText(args, 'capabilityId', 'operations')} in this space, starting as ${argText(args, 'status', 'next')}, due ${argText(args, 'dueDate', EMPTY)}.`,
  },
  {
    id: 'update_task',
    label: 'Update a task',
    description:
      'Change an existing task’s status, priority, due date, notes or blocked reason. Resolved through the current scope, so a task in another space cannot be reached.',
    risk: 'write',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['update the task', 'change the task', 'move the task', 'reprioritise', 'reprioritize', 'push the deadline', 'blocked on', 'mark as blocked'],
    params: [
      { name: 'taskId', type: 'string', description: 'Id of a task in this space.', required: true },
      { name: 'status', type: 'enum', description: 'New status.', required: false, enumValues: TASK_STATUSES },
      { name: 'priority', type: 'enum', description: 'New priority.', required: false, enumValues: PRIORITIES },
      { name: 'dueDate', type: 'date', description: 'New due date, YYYY-MM-DD.', required: false },
      { name: 'estimateMinutes', type: 'number', description: 'Revised size in minutes.', required: false },
      { name: 'notes', type: 'text', description: 'Replacement notes.', required: false },
      { name: 'blockedReason', type: 'string', description: 'What is holding it up.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Update task ${argText(args, 'taskId', EMPTY)} in this space: status ${argText(args, 'status', 'unchanged')}, priority ${argText(args, 'priority', 'unchanged')}, due ${argText(args, 'dueDate', 'unchanged')}.`,
  },
  {
    id: 'complete_task',
    label: 'Complete a task',
    description: 'Mark a task done and stamp when it finished.',
    risk: 'write',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['mark it done', 'complete the task', 'finished the task', 'tick it off', 'that is done', 'close the task'],
    params: [{ name: 'taskId', type: 'string', description: 'Id of a task in this space.', required: true }],
    preview: (args: ToolArgs) =>
      `Mark task ${argText(args, 'taskId', EMPTY)} as done in this space and record the completion time.`,
  },
  {
    id: 'create_goal',
    label: 'Create a goal',
    description: 'Add a goal at a chosen horizon. Goals are what tasks and KPIs are judged against.',
    risk: 'write',
    capabilityId: 'strategy',
    scopeKinds: BOTH,
    matches: ['set a goal', 'create a goal', 'new goal', 'my target for', 'i want to reach', 'objective'],
    params: [
      { name: 'title', type: 'string', description: 'The goal, stated as an outcome.', required: true },
      { name: 'horizon', type: 'enum', description: 'How far out it sits.', required: false, enumValues: GOAL_HORIZONS, default: 'quarter' },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Capability that owns it.',
        required: false,
        enumValues: capabilityIds(),
        default: 'strategy',
      },
      { name: 'targetDate', type: 'date', description: 'YYYY-MM-DD.', required: false },
      { name: 'description', type: 'text', description: 'What achieving it looks like.', required: false },
      { name: 'why', type: 'text', description: 'Why it matters — quoted back when the goal is at risk.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Create a ${argText(args, 'horizon', 'quarter')} goal ${quoted(args, 'title', 'untitled')} under ${argText(args, 'capabilityId', 'strategy')} in this space, at 0% progress and on-track, targeting ${argText(args, 'targetDate', EMPTY)}.`,
  },
  {
    id: 'update_goal',
    label: 'Update a goal',
    description: 'Move a goal’s status, progress or target date.',
    risk: 'write',
    capabilityId: 'strategy',
    scopeKinds: BOTH,
    matches: ['update the goal', 'goal is at risk', 'goal progress', 'we hit the goal', 'achieved the goal', 'pause the goal'],
    params: [
      { name: 'goalId', type: 'string', description: 'Id of a goal in this space.', required: true },
      { name: 'status', type: 'enum', description: 'New status.', required: false, enumValues: GOAL_STATUSES },
      { name: 'progress', type: 'number', description: '0 to 1. Only set it when there is something to base it on.', required: false },
      { name: 'targetDate', type: 'date', description: 'New target date, YYYY-MM-DD.', required: false },
    ],
    preview: (args: ToolArgs) => {
      const progress = argNumber(args, 'progress');
      return `Update goal ${argText(args, 'goalId', EMPTY)} in this space: status ${argText(args, 'status', 'unchanged')}, progress ${progress === undefined ? 'unchanged' : `${Math.round(progress * 100)}%`}, target ${argText(args, 'targetDate', 'unchanged')}.`;
    },
  },
  {
    id: 'add_kpi',
    label: 'Add a KPI',
    description:
      'Start tracking a metric. The first reading becomes the whole series — nothing is back-filled, because invented history would be indistinguishable from measured history.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: ['track a metric', 'add a kpi', 'new kpi', 'start measuring', 'i want to track'],
    params: [
      { name: 'label', type: 'string', description: 'What the number is.', required: true },
      { name: 'value', type: 'number', description: 'The current reading.', required: true },
      { name: 'format', type: 'enum', description: 'How to render it.', required: false, enumValues: KPI_FORMATS, default: 'number' },
      { name: 'direction', type: 'enum', description: 'Which way is good.', required: false, enumValues: KPI_DIRECTIONS, default: 'up-good' },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Capability this metric belongs to.',
        required: false,
        enumValues: capabilityIds(),
        default: 'executive',
      },
      { name: 'period', type: 'string', description: 'What the reading covers, e.g. “this month”.', required: false, default: 'current' },
      { name: 'target', type: 'number', description: 'Where it should get to.', required: false },
      { name: 'currency', type: 'enum', description: 'Only when the format is money.', required: false, enumValues: CURRENCIES },
    ],
    preview: (args: ToolArgs) =>
      `Start tracking ${quoted(args, 'label', 'a metric')} in this space at ${say(argNumber(args, 'value'))} (${argText(args, 'format', 'number')}, ${argText(args, 'direction', 'up-good')}), covering ${argText(args, 'period', 'current')}, with a target of ${say(argNumber(args, 'target'))}.`,
  },
  {
    id: 'record_kpi_value',
    label: 'Record a KPI reading',
    description: 'Append a new reading to an existing KPI. The old value becomes the comparison point.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: ['record the number', 'update the kpi', 'this month we did', 'log the metric', 'new reading'],
    params: [
      { name: 'kpiId', type: 'string', description: 'Id of a KPI in this space.', required: true },
      { name: 'value', type: 'number', description: 'The new reading.', required: true },
      { name: 'period', type: 'string', description: 'What this reading covers.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Record ${say(argNumber(args, 'value'))} against KPI ${argText(args, 'kpiId', EMPTY)} in this space, keeping the previous reading as the comparison and appending to its series.`,
  },
  {
    id: 'write_doc',
    label: 'Write a document',
    description:
      'Store a document, SOP, decision or note in this space’s knowledge base. Use when the founder says something worth keeping in prose rather than as a record.',
    risk: 'write',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['write it up', 'document this', 'write a doc', 'create an sop', 'record the decision', 'write a note', 'save this as'],
    params: [
      { name: 'title', type: 'string', description: 'Document title.', required: true },
      { name: 'body', type: 'text', description: 'The document itself.', required: true },
      { name: 'kind', type: 'enum', description: 'What sort of document it is.', required: false, enumValues: DOC_KINDS, default: 'doc' },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Capability it files under.',
        required: false,
        enumValues: capabilityIds(),
        default: 'operations',
      },
      { name: 'tags', type: 'string', description: 'Comma-separated tags.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Write a ${argText(args, 'kind', 'doc')} titled ${quoted(args, 'title', 'untitled')} (${argText(args, 'body', '').length} characters) into ${argText(args, 'capabilityId', 'operations')} in this space.`,
  },
  {
    id: 'add_roadmap_item',
    label: 'Add a roadmap item',
    description: 'Put something on the roadmap at a named stage and horizon.',
    risk: 'write',
    capabilityId: 'development',
    scopeKinds: BOTH,
    matches: ['add to the roadmap', 'roadmap item', 'we should build', 'ship in q', 'next quarter we', 'feature idea'],
    params: [
      { name: 'title', type: 'string', description: 'What would be built.', required: true },
      { name: 'stage', type: 'enum', description: 'Where it sits today.', required: false, enumValues: ROADMAP_STAGES, default: 'idea' },
      { name: 'horizon', type: 'string', description: 'When, in the founder’s own terms, e.g. “Q3”.', required: false, default: 'unscheduled' },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Capability that would build it.',
        required: false,
        enumValues: capabilityIds(),
        default: 'development',
      },
      { name: 'summary', type: 'text', description: 'One paragraph on what it is.', required: false },
      { name: 'confidence', type: 'number', description: '0 to 1 — how sure this happens.', required: false, default: 0.5 },
    ],
    preview: (args: ToolArgs) =>
      `Add ${quoted(args, 'title', 'an item')} to the ${argText(args, 'capabilityId', 'development')} roadmap in this space at stage ${argText(args, 'stage', 'idea')}, horizon ${argText(args, 'horizon', 'unscheduled')}.`,
  },
  {
    id: 'add_risk',
    label: 'Add a risk or bottleneck',
    description: 'Name a risk or a bottleneck so it stops living only in the founder’s head.',
    risk: 'write',
    capabilityId: 'strategy',
    scopeKinds: BOTH,
    matches: ['flag a risk', 'add a risk', 'this is a bottleneck', 'worried about', 'exposure', 'single point of failure'],
    params: [
      { name: 'label', type: 'string', description: 'The risk, in a few words.', required: true },
      { name: 'detail', type: 'text', description: 'What happens if it lands.', required: true },
      { name: 'severity', type: 'enum', description: 'How bad.', required: false, enumValues: SEVERITIES, default: 'medium' },
      { name: 'kind', type: 'enum', description: 'A risk is a future event; a bottleneck is already costing time.', required: false, enumValues: ['risk', 'bottleneck'], default: 'risk' },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Capability it threatens.',
        required: false,
        enumValues: capabilityIds(),
        default: 'strategy',
      },
      { name: 'mitigation', type: 'text', description: 'What would reduce it.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Record a ${argText(args, 'severity', 'medium')}-severity ${argText(args, 'kind', 'risk')} ${quoted(args, 'label', 'unnamed')} against ${argText(args, 'capabilityId', 'strategy')} in this space.`,
  },
  /* ------------------------------------------------------------- crm ------ */
  {
    id: 'add_contact',
    label: 'Add a contact',
    description: 'Add someone to this space’s pipeline with a stage and, when known, a deal value.',
    risk: 'write',
    capabilityId: 'sales',
    scopeKinds: BOTH,
    matches: ['add a contact', 'new lead', 'add them to the pipeline', 'met someone', 'new prospect', 'add to crm'],
    params: [
      { name: 'name', type: 'string', description: 'Person’s name.', required: true },
      { name: 'organisation', type: 'string', description: 'Where they work.', required: false },
      { name: 'role', type: 'string', description: 'Their role.', required: false },
      { name: 'stage', type: 'enum', description: 'Pipeline stage.', required: false, enumValues: CRM_STAGES, default: 'lead' },
      { name: 'amountMinor', type: 'number', description: 'Deal value in integer minor units (rappen/cents). Omit unless there is a real figure.', required: false },
      { name: 'currency', type: 'enum', description: 'Currency of the deal value.', required: false, enumValues: CURRENCIES, default: 'CHF' },
      { name: 'notes', type: 'text', description: 'Context worth keeping.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Add ${quoted(args, 'name', 'a contact')}${argText(args, 'organisation') ? ` of ${argText(args, 'organisation')}` : ''} to this space’s pipeline at stage ${argText(args, 'stage', 'lead')}, worth ${money(args)}.`,
  },
  {
    id: 'log_contact_touch',
    label: 'Log a contact touch',
    description: 'Record that a contact was spoken to, and when the next follow-up is due.',
    risk: 'write',
    capabilityId: 'sales',
    scopeKinds: BOTH,
    matches: ['spoke to', 'called them', 'had a meeting with', 'followed up with', 'log the call', 'met with'],
    params: [
      { name: 'contactId', type: 'string', description: 'Id of a contact in this space.', required: true },
      { name: 'note', type: 'text', description: 'What was said.', required: false },
      { name: 'nextTouchAt', type: 'date', description: 'When to follow up, YYYY-MM-DD.', required: false },
      { name: 'stage', type: 'enum', description: 'Move them along the pipeline, if the conversation did.', required: false, enumValues: CRM_STAGES },
    ],
    preview: (args: ToolArgs) =>
      `Record contact ${argText(args, 'contactId', EMPTY)} in this space as touched now, next follow-up ${argText(args, 'nextTouchAt', EMPTY)}, stage ${argText(args, 'stage', 'unchanged')}.`,
  },
  /* --------------------------------------------------------- finance ------ */
  {
    id: 'add_finance_entry',
    label: 'Add a finance entry',
    description:
      'Add money in or out to this space’s ledger. Amounts are integer minor units so nothing rounds on the way in.',
    risk: 'write',
    capabilityId: 'finance',
    scopeKinds: BOTH,
    matches: ['log an expense', 'add an invoice', 'record a payment', 'we got paid', 'add to the ledger', 'booked revenue', 'paid for'],
    params: [
      { name: 'date', type: 'date', description: 'When it happened, YYYY-MM-DD.', required: true },
      { name: 'direction', type: 'enum', description: 'in is money received, out is money spent.', required: true, enumValues: FINANCE_DIRECTIONS },
      { name: 'amountMinor', type: 'number', description: 'Integer minor units (rappen/cents). CHF 1 250.00 is 125000.', required: true },
      { name: 'currency', type: 'enum', description: 'Currency.', required: false, enumValues: CURRENCIES, default: 'CHF' },
      { name: 'label', type: 'string', description: 'What it was.', required: true },
      { name: 'category', type: 'string', description: 'Ledger category.', required: false, default: 'uncategorised' },
      { name: 'confidence', type: 'enum', description: 'actual has happened; forecast has not.', required: false, enumValues: FINANCE_CONFIDENCE, default: 'actual' },
      { name: 'recurring', type: 'boolean', description: 'True when it repeats.', required: false, default: false },
      { name: 'counterparty', type: 'string', description: 'Who it was with.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Record ${money(args)} ${argText(args, 'direction', 'out')} on ${argText(args, 'date', EMPTY)} in this space’s ledger as ${quoted(args, 'label', 'unlabelled')} (${argText(args, 'category', 'uncategorised')}, ${argText(args, 'confidence', 'actual')}${argFlag(args, 'recurring') ? ', recurring' : ''}).`,
  },
  /* ------------------------------------------------------ automation ------ */
  {
    id: 'create_automation',
    label: 'Create an automation',
    description:
      'Draft an automation with local steps. It is always created as a draft and never with a step that reaches outside OmniOS — an assistant cannot grant itself external reach by writing a record.',
    risk: 'write',
    capabilityId: 'automation',
    scopeKinds: BOTH,
    matches: ['automate this', 'create an automation', 'set up a workflow', 'every week automatically', 'i keep doing this manually', 'build a routine'],
    params: [
      { name: 'name', type: 'string', description: 'What the automation is called.', required: true },
      { name: 'description', type: 'text', description: 'What it does and why.', required: true },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Capability it serves.',
        required: false,
        enumValues: capabilityIds(),
        default: 'automation',
      },
      { name: 'trigger', type: 'enum', description: 'What sets it off.', required: false, enumValues: AUTOMATION_TRIGGERS, default: 'manual' },
      { name: 'triggerDetail', type: 'string', description: 'The trigger in words, e.g. “Mondays 07:00”.', required: false, default: 'on request' },
      { name: 'steps', type: 'text', description: 'Comma-separated step labels. Every step is created as local-only.', required: false },
      { name: 'minutesSavedPerRun', type: 'number', description: 'Minutes a run stands in for. Omit when unknown.', required: false },
    ],
    preview: (args: ToolArgs) => {
      const steps = argText(args, 'steps', '').split(',').map((s) => s.trim()).filter(Boolean);
      return `Draft an automation ${quoted(args, 'name', 'untitled')} in this space under ${argText(args, 'capabilityId', 'automation')}, triggered ${argText(args, 'trigger', 'manual')} (${argText(args, 'triggerDetail', 'on request')}), with ${steps.length} local step${steps.length === 1 ? '' : 's'}. It is created paused as a draft and cannot reach outside OmniOS.`;
    },
  },
  {
    id: 'set_automation_status',
    label: 'Arm or pause an automation',
    description:
      'Arm or pause an existing automation. Arming does not let it act externally: a run whose steps are external still refuses and records awaiting-approval.',
    risk: 'write',
    capabilityId: 'automation',
    scopeKinds: BOTH,
    matches: ['arm the automation', 'pause the automation', 'turn it on', 'turn it off', 'stop the automation', 'enable the workflow'],
    params: [
      { name: 'automationId', type: 'string', description: 'Id of an automation in this space.', required: true },
      { name: 'status', type: 'enum', description: 'draft and failing are observed, not asserted, so only these two are settable.', required: true, enumValues: ['armed', 'paused'] },
    ],
    preview: (args: ToolArgs) =>
      `Set automation ${argText(args, 'automationId', EMPTY)} in this space to ${argText(args, 'status', 'paused')}. Nothing external can fire as a result.`,
  },
  /* --------------------------------------------------------- creative ---- */
  {
    id: 'create_brief',
    label: 'Create a creative brief',
    description:
      'Capture a creative brief bound to this space’s Brand DNA, so every asset made from it inherits the same voice.',
    risk: 'write',
    capabilityId: 'creative',
    scopeKinds: BOTH,
    matches: ['create a brief', 'creative brief', 'i need an ad', 'design a campaign', 'brief the studio', 'we need assets for'],
    params: [
      { name: 'title', type: 'string', description: 'Brief title.', required: true },
      { name: 'objective', type: 'text', description: 'What the work has to achieve.', required: true },
      { name: 'audience', type: 'string', description: 'Who it is for.', required: true },
      { name: 'keyMessage', type: 'text', description: 'The one thing they should take away.', required: true },
      { name: 'formats', type: 'string', description: `Comma-separated asset kinds from: ${ASSET_KINDS.join(', ')}.`, required: false },
      { name: 'mustInclude', type: 'text', description: 'Comma-separated non-negotiables.', required: false },
      { name: 'mustAvoid', type: 'text', description: 'Comma-separated things this brand never does.', required: false },
      { name: 'channel', type: 'string', description: 'Where it runs.', required: false },
      { name: 'toneOverride', type: 'string', description: 'Only when this brief departs from Brand DNA.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Create a creative brief ${quoted(args, 'title', 'untitled')} in this space for ${quoted(args, 'audience', 'an unnamed audience')}, formats: ${argText(args, 'formats', EMPTY)}. No asset is generated by this call.`,
  },
  /* ----------------------------------------------------------- memory ---- */
  {
    id: 'remember',
    label: 'Remember something',
    description:
      'Write a memory record into this space. It stays in this scope forever unless the founder explicitly promotes it through the gate — this tool cannot write shared memory.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: ['remember that', 'keep in mind', 'note that i prefer', 'i always', 'never do that again', 'lesson learned', 'for future reference'],
    params: [
      { name: 'text', type: 'text', description: 'What to remember, stated so it is still useful in a year.', required: true },
      { name: 'kind', type: 'enum', description: 'What sort of memory it is.', required: false, enumValues: MEMORY_KINDS, default: 'fact' },
      {
        name: 'capabilityId',
        type: 'enum',
        description: 'Capability it is relevant to.',
        required: false,
        enumValues: capabilityIds(),
        default: 'executive',
      },
      { name: 'tags', type: 'string', description: 'Comma-separated tags.', required: false },
      { name: 'strength', type: 'number', description: '0 to 1 — how strongly to hold it.', required: false, default: 0.6 },
    ],
    preview: (args: ToolArgs) =>
      `Remember, as a ${argText(args, 'kind', 'fact')} under ${argText(args, 'capabilityId', 'executive')} in this space only: ${quoted(args, 'text', 'nothing')}.`,
  },
  /* ------------------------------------------------------------ life ----- */
  {
    id: 'log_health_day',
    label: 'Log a health day',
    description:
      'Record a day of body data. Every field is optional and nothing missing is filled in — energy is derived only when enough inputs are present.',
    risk: 'write',
    capabilityId: 'health',
    scopeKinds: PERSONAL,
    matches: ['slept', 'hours of sleep', 'log my sleep', 'my hrv', 'resting heart rate', 'log my workout', 'trained today', 'steps today', 'stressed today'],
    params: [
      { name: 'date', type: 'date', description: 'The day, YYYY-MM-DD.', required: true },
      { name: 'sleepHours', type: 'number', description: 'Hours slept.', required: false },
      { name: 'sleepQuality', type: 'number', description: '0 to 100.', required: false },
      { name: 'restingHeartRate', type: 'number', description: 'bpm.', required: false },
      {
        name: 'hrv',
        type: 'number',
        description: 'Heart rate variability in milliseconds. The strongest single input to the energy score.',
        required: false,
      },
      { name: 'steps', type: 'number', description: 'Step count.', required: false },
      { name: 'workoutMinutes', type: 'number', description: 'Minutes trained.', required: false },
      { name: 'workoutKind', type: 'string', description: 'What sort of training.', required: false },
      { name: 'stress', type: 'number', description: '0 to 100.', required: false },
      { name: 'mood', type: 'number', description: '0 to 100.', required: false },
      { name: 'notes', type: 'text', description: 'Anything else about the day.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Record ${argText(args, 'date', EMPTY)} in personal health: sleep ${say(argNumber(args, 'sleepHours'))}h, HRV ${say(argNumber(args, 'hrv'))}, stress ${say(argNumber(args, 'stress'))}, workout ${say(argNumber(args, 'workoutMinutes'))} min. Energy is derived from what is present, or left blank.`,
  },
  {
    id: 'add_habit',
    label: 'Add a habit',
    description: 'Start tracking a habit with a cadence and a weekly target.',
    risk: 'write',
    capabilityId: 'health',
    scopeKinds: PERSONAL,
    matches: ['start a habit', 'add a habit', 'i want to do this every day', 'build the habit of', 'track my streak'],
    params: [
      { name: 'name', type: 'string', description: 'The habit.', required: true },
      { name: 'cadence', type: 'enum', description: 'How often it is meant to happen.', required: false, enumValues: HABIT_CADENCES, default: 'daily' },
      { name: 'intent', type: 'text', description: 'Why — read back when the streak breaks.', required: true },
      { name: 'targetPerWeek', type: 'number', description: 'Times per week that counts as keeping it.', required: false, default: 5 },
    ],
    preview: (args: ToolArgs) =>
      `Start tracking the habit ${quoted(args, 'name', 'unnamed')} in personal life, ${argText(args, 'cadence', 'daily')}, targeting ${say(argNumber(args, 'targetPerWeek'))} times a week, with no completions yet.`,
  },
  {
    id: 'complete_habit',
    label: 'Complete a habit',
    description: 'Mark a habit done for a day. Completing the same day twice changes nothing.',
    risk: 'write',
    capabilityId: 'health',
    scopeKinds: PERSONAL,
    matches: ['did my habit', 'kept the streak', 'completed my', 'i did it today', 'tick the habit'],
    params: [
      { name: 'habitId', type: 'string', description: 'Id of a habit in personal life.', required: true },
      { name: 'date', type: 'date', description: 'The day it was kept. Defaults to today.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Mark habit ${argText(args, 'habitId', EMPTY)} as kept on ${argText(args, 'date', 'today')} in personal life.`,
  },
  {
    id: 'add_relationship',
    label: 'Add a relationship',
    description: 'Add a person to a circle with a contact cadence, so drifting apart becomes visible rather than accidental.',
    risk: 'write',
    capabilityId: 'relationships',
    scopeKinds: PERSONAL,
    matches: ['add to my circle', 'stay in touch with', 'add a friend', 'my mentor', 'keep up with', 'add a relationship'],
    params: [
      { name: 'name', type: 'string', description: 'Their name.', required: true },
      { name: 'circle', type: 'enum', description: 'Which circle they belong to.', required: false, enumValues: RELATIONSHIP_CIRCLES, default: 'friends' },
      { name: 'cadenceDays', type: 'number', description: 'Days between contact that feels right.', required: false, default: 30 },
      { name: 'relation', type: 'string', description: 'How they are related.', required: false },
      { name: 'nextIntent', type: 'string', description: 'What to do next time.', required: false },
      { name: 'notes', type: 'text', description: 'Anything worth remembering about them.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Add ${quoted(args, 'name', 'someone')} to the ${argText(args, 'circle', 'friends')} circle in personal life, with a contact cadence of ${say(argNumber(args, 'cadenceDays'))} days.`,
  },
  {
    id: 'schedule_block',
    label: 'Schedule a block',
    description:
      'Put a block on the calendar in this space. It writes a local calendar record; it does not touch any external calendar.',
    risk: 'write',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['block time', 'put it in the calendar', 'schedule a block', 'book two hours', 'deep work block', 'protect the morning'],
    params: [
      { name: 'title', type: 'string', description: 'What the block is for.', required: true },
      { name: 'date', type: 'date', description: 'The day, YYYY-MM-DD.', required: true },
      { name: 'startMinute', type: 'number', description: 'Minutes past midnight. 09:30 is 570.', required: true },
      { name: 'durationMinutes', type: 'number', description: 'How long it runs.', required: false, default: 60 },
      { name: 'kind', type: 'enum', description: 'What sort of block it is.', required: false, enumValues: CALENDAR_BLOCK_KINDS, default: 'deep-work' },
    ],
    preview: (args: ToolArgs) => {
      const start = argNumber(args, 'startMinute');
      const clock =
        start === undefined
          ? EMPTY
          : `${String(Math.floor(start / 60) % 24).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      return `Block ${say(argNumber(args, 'durationMinutes'))} minutes from ${clock} on ${argText(args, 'date', EMPTY)} for ${quoted(args, 'title', 'untitled')} (${argText(args, 'kind', 'deep-work')}) in this space’s calendar only.`;
    },
  },
  {
    id: 'add_life_admin',
    label: 'Add a life admin item',
    description: 'Track an appointment, renewal, document or errand so it stops occupying working memory.',
    risk: 'write',
    capabilityId: 'life-ops',
    scopeKinds: PERSONAL,
    matches: ['renew my', 'book an appointment', 'i need to sort out', 'paperwork', 'my passport', 'insurance', 'tax return', 'life admin'],
    params: [
      { name: 'title', type: 'string', description: 'What needs handling.', required: true },
      { name: 'kind', type: 'enum', description: 'What sort of item.', required: false, enumValues: LIFE_ADMIN_KINDS, default: 'admin' },
      { name: 'dueDate', type: 'date', description: 'When it is due, YYYY-MM-DD.', required: false },
      { name: 'detail', type: 'text', description: 'What is involved.', required: false },
      { name: 'location', type: 'string', description: 'Where.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Add the ${argText(args, 'kind', 'admin')} item ${quoted(args, 'title', 'untitled')} to personal life admin, due ${argText(args, 'dueDate', EMPTY)}, open.`,
  },
  /* ----------------------------------------------------- suggestions ----- */
  {
    id: 'accept_suggestion',
    label: 'Accept a suggestion',
    description:
      'Mark a suggestion as accepted. Accepting records the decision; it does not carry the suggestion out.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: ['accept that suggestion', 'good idea, do it', 'take that recommendation', 'agree with the recommendation'],
    params: [{ name: 'suggestionId', type: 'string', description: 'Id of a suggestion in this space.', required: true }],
    preview: (args: ToolArgs) =>
      `Mark suggestion ${argText(args, 'suggestionId', EMPTY)} in this space as accepted. Nothing it proposes is carried out by this call.`,
  },
  {
    id: 'dismiss_suggestion',
    label: 'Dismiss a suggestion',
    description: 'Mark a suggestion as dismissed, so the specialist that made it is scored honestly.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: ['dismiss that', 'not interested', 'ignore that suggestion', 'reject the recommendation', 'no thanks'],
    params: [{ name: 'suggestionId', type: 'string', description: 'Id of a suggestion in this space.', required: true }],
    preview: (args: ToolArgs) =>
      `Mark suggestion ${argText(args, 'suggestionId', EMPTY)} in this space as dismissed.`,
  },
  /* ---------------------------------------------------- destructive ------ */
  {
    id: 'delete_record',
    label: 'Delete a record',
    description:
      'Permanently remove one record from a collection in this space. Nothing that is part of the audit trail — tool calls, agent runs, automation runs, messages, the evolution log — can be reached this way.',
    risk: 'destructive',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['delete that', 'remove the record', 'get rid of', 'delete the task', 'take it off the list permanently'],
    params: [
      { name: 'collection', type: 'enum', description: 'Which collection the record is in.', required: true, enumValues: DELETABLE_COLLECTIONS },
      { name: 'recordId', type: 'string', description: 'Id of the record, resolved through this scope.', required: true },
    ],
    preview: (args: ToolArgs) =>
      `Permanently delete record ${argText(args, 'recordId', EMPTY)} from ${argText(args, 'collection', EMPTY)} in this space. This cannot be undone from inside OmniOS.`,
  },
  {
    id: 'reset_capability_data',
    label: 'Reset a capability’s data',
    description:
      'Delete every record belonging to one capability in this space — tasks, goals, KPIs, roadmap, automations, docs, risks, suggestions, memory and observations. The evolution log survives, because a reset that erased its own record would make every other guarantee here unfalsifiable.',
    risk: 'destructive',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['reset the capability', 'wipe marketing', 'clear everything in', 'start that section over', 'delete all the data for'],
    params: [
      { name: 'capabilityId', type: 'enum', description: 'The capability to clear.', required: true, enumValues: capabilityIds() },
    ],
    preview: (args: ToolArgs) =>
      `Permanently delete every ${argText(args, 'capabilityId', EMPTY)} record in this space across ${CAPABILITY_SCOPED_COLLECTIONS.length} collections (${CAPABILITY_SCOPED_COLLECTIONS.join(', ')}). The evolution log is left intact. This cannot be undone from inside OmniOS.`,
  },
  /* -------------------------------------------------------- external ----- */
  {
    id: 'send_email',
    label: 'Send an email',
    description:
      'Would send an email through a configured provider. Declared so the approval gate is exercised end to end; V1 has no provider wired and the executor refuses rather than pretending.',
    risk: 'external',
    capabilityId: 'sales',
    scopeKinds: BOTH,
    matches: ['send an email', 'email them', 'reply to', 'send the proposal', 'mail it out', 'send a follow-up email'],
    params: [
      { name: 'to', type: 'string', description: 'Recipient address.', required: true },
      { name: 'subject', type: 'string', description: 'Subject line.', required: true },
      { name: 'body', type: 'text', description: 'The message.', required: true },
      { name: 'apiKey', type: 'string', description: 'Provider credential as {{secret:NAME}}. The placeholder is what is stored; the value is resolved only inside the executor.', required: false, acceptsSecret: true },
    ],
    preview: (args: ToolArgs) =>
      `Send an email to ${quoted(args, 'to', 'nobody')} with subject ${quoted(args, 'subject', 'no subject')} (${argText(args, 'body', '').length} characters). This leaves OmniOS and needs your approval — and in V1 no email provider is wired, so it will refuse rather than send.`,
  },
  {
    id: 'publish_post',
    label: 'Publish a post',
    description:
      'Would publish a post to an external channel. Declared so the approval gate is exercised end to end; V1 has no channel wired and the executor refuses rather than pretending.',
    risk: 'external',
    capabilityId: 'marketing',
    scopeKinds: BOTH,
    matches: ['publish it', 'post it on', 'put it live', 'share on linkedin', 'tweet this', 'push it to instagram'],
    params: [
      { name: 'channel', type: 'string', description: 'Where it would go.', required: true },
      { name: 'body', type: 'text', description: 'The post.', required: true },
      { name: 'assetId', type: 'string', description: 'Asset in this space to attach.', required: false },
      { name: 'apiKey', type: 'string', description: 'Channel credential as {{secret:NAME}}. Resolved only inside the executor.', required: false, acceptsSecret: true },
    ],
    preview: (args: ToolArgs) =>
      `Publish a ${argText(args, 'body', '').length}-character post to ${quoted(args, 'channel', 'an unnamed channel')} from this space. This leaves OmniOS and needs your approval — and in V1 no channel is wired, so it will refuse rather than publish.`,
  },
  {
    id: 'call_webhook',
    label: 'Call a webhook',
    description:
      'Would make an HTTP request to a third party. Declared so the approval gate is exercised end to end; V1 makes no outbound network call and the executor refuses rather than pretending.',
    risk: 'external',
    capabilityId: 'automation',
    scopeKinds: BOTH,
    matches: ['call the webhook', 'hit the api', 'post to the endpoint', 'trigger zapier', 'fire the webhook', 'send it to make.com'],
    params: [
      { name: 'url', type: 'string', description: 'Endpoint that would be called.', required: true },
      { name: 'method', type: 'enum', description: 'HTTP method.', required: false, enumValues: ['GET', 'POST', 'PUT', 'DELETE'], default: 'POST' },
      { name: 'body', type: 'text', description: 'Request body.', required: false },
      { name: 'authHeader', type: 'string', description: 'Authorization header as {{secret:NAME}}. Resolved only inside the executor.', required: false, acceptsSecret: true },
    ],
    preview: (args: ToolArgs) =>
      `${argText(args, 'method', 'POST')} to ${quoted(args, 'url', 'no endpoint')} from this space. This leaves OmniOS and needs your approval — and in V1 no outbound request is made, so it will refuse rather than call.`,
  },
] as const satisfies readonly ToolDefinition[];

/**
 * The literal ids, so `executors.ts` can type its table as `Record<ToolId, …>`
 * and a tool declared without an executor fails to compile.
 */
export type ToolId = (typeof TOOL_LIST)[number]['id'];

/**
 * The widened list every consumer reads.
 *
 * `TOOL_LIST` keeps its literal types only long enough to derive {@link ToolId};
 * exporting the narrow tuple would force every caller to reason about 30 distinct
 * object shapes where they only ever want a `ToolDefinition`.
 */
export const TOOLS: readonly ToolDefinition[] = TOOL_LIST;
