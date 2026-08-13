import 'server-only';

/**
 * Tool executors — the only code in OmniOS that changes a workspace on the
 * assistant's behalf.
 *
 * Three properties hold across every executor in this file:
 *
 * 1. **Everything goes through `lib/data/store.ts`.** No executor touches the
 *    filesystem, and every read and write names a scope, so a crafted id cannot
 *    reach a record in another space — it is simply not in the collection that
 *    was read.
 * 2. **The tier is the gate, and the gate lives in `runTool`.** Executors are
 *    never called directly by application code; `runTool` asks
 *    `requiresApproval(tool.risk)` first and refuses without a recorded
 *    decision. Putting the check anywhere else — a component, a Server Action,
 *    a prompt — would make it something a caller could forget.
 * 3. **Secret plaintext never leaves an executor.** Only `ctx.resolveSecrets`
 *    can produce it, the resolved string is used and dropped, and the outcome is
 *    run through `redact` on the way out. The persisted `ToolCall` keeps the
 *    `{{secret:NAME}}` placeholder, never the value.
 *
 * The three `external` tools are declared and refuse. That is deliberate: an
 * executor that pretended to send an email would be a lie in the one place a
 * founder most needs the system to be literal, and declaring them is what proves
 * the approval gate works end to end.
 */

import type { CustomAgent } from '@/lib/domain';
import type {
  ApprovalPolicy,
  Automation,
  AutomationStep,
  CalendarBlock,
  Contact,
  CreativeBrief,
  FinanceEntry,
  Goal,
  Habit,
  HealthDay,
  KnowledgeDoc,
  Kpi,
  LifeAdminItem,
  MemoryRecord,
  Relationship,
  RiskItem,
  RoadmapItem,
  Task,
  Timestamp,
  ToolArgs,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolOutcome,
} from '@/lib/domain';
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
  COMPANY_STAGES,
  ROADMAP_STAGES,
  SEVERITIES,
  TASK_STATUSES,
  agentIdFrom,
  companyScope,
  makeRecordId,
  parseMcpToolId,
  redact,
  referencedSecretNames,
  requiresApproval,
  scopeKey,
  validateArgs,
} from '@/lib/domain';
import type { ScopeData } from '@/lib/data/schema';
import {
  getWorkspace,
  saveWorkspace,
  writeScopeData,
  insertRecords,
  mutateScope,
  readCollection,
  removeRecord,
  updateRecord,
} from '@/lib/data/store';
import { SEARCHABLE_COLLECTIONS } from './registry';
import { formatMinorAmount } from '@/lib/format';
import { generateCompanyWorkspace } from '@/lib/generation/company-hq';
import { getPreset } from '@/lib/ai/agent-presets';
import { newMeeting, recommendParticipants } from '@/lib/ai/meeting';
import { rosterFor } from '@/lib/ai/roster';
import { embedTexts } from '@/lib/ai/embeddings';
import { callMcpTool } from '@/lib/mcp/client';
import { mcpToolDefinition } from './mcp-bridge';
import { capabilitiesFor, getCapability } from '@/lib/capabilities/registry';
import { allSecretValues } from '@/lib/secrets/vault';
import {
  CAPABILITY_SCOPED_COLLECTIONS,
  CALENDAR_BLOCK_KINDS,
  DELETABLE_COLLECTIONS,
  argFlag,
  argNumber,
  argText,
  getTool,
  type DeletableCollection,
  type ToolId,
} from './index';

/* ------------------------------------------------------------- helpers ---- */

const ok = (summary: string, affectedIds: readonly string[] = []): ToolOutcome => ({
  ok: true,
  summary,
  affectedIds,
});

const refuse = (summary: string, error: string): ToolOutcome => ({
  ok: false,
  summary,
  error,
  affectedIds: [],
});

/** A shared capability scope holds generalised lessons, never runnable records. */
function spaceKindOf(ctx: ToolContext): 'company' | 'personal' | null {
  return ctx.scope.kind === 'shared' ? null : ctx.scope.kind;
}

const stampOf = (ctx: ToolContext): Timestamp => ctx.now.toISOString();
const dayOf = (ctx: ToolContext): string => ctx.now.toISOString().slice(0, 10);

/**
 * Ids are derived from scope, time and content rather than randomness, so the
 * same call in a test produces the same id every run. The call id (unique per
 * proposed call, sequence included) is mixed in so two same-titled creations
 * within one frozen-clock turn cannot collide — see ToolContext.callId.
 */
function newId(ctx: ToolContext, prefix: string, seed: string): string {
  return makeRecordId(prefix, `${scopeKey(ctx.scope)}:${stampOf(ctx)}:${ctx.callId ?? ''}:${seed}`);
}

function base(ctx: ToolContext, prefix: string, seed: string) {
  const at = stampOf(ctx);
  return { id: newId(ctx, prefix, seed), scope: ctx.scope, createdAt: at, updatedAt: at };
}

function optText(args: ToolArgs, name: string): string | undefined {
  const value = argText(args, name);
  return value === '' ? undefined : value;
}

function enumArg<T extends string>(args: ToolArgs, name: string, allowed: readonly T[], fallback: T): T {
  const raw = argText(args, name);
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function optEnum<T extends string>(args: ToolArgs, name: string, allowed: readonly T[]): T | undefined {
  const raw = argText(args, name);
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

const listArg = (args: ToolArgs, name: string): string[] =>
  argText(args, name, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

/** 0..1 values arrive from models as anything. Clamp rather than store nonsense. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function capabilityFor(ctx: ToolContext, args: ToolArgs, fallback: string): string {
  const kind = spaceKindOf(ctx);
  const requested = argText(args, 'capabilityId', fallback);
  if (!kind) return fallback;
  // A capability that does not apply to this space kind would file the record
  // somewhere no page in this space ever renders.
  return capabilitiesFor(kind).some((c) => c.id === requested) ? requested : fallback;
}

const missing = (what: string): ToolOutcome =>
  refuse(`${what} is not in this space.`, `${what} could not be found in this scope.`);

/* --------------------------------------------------------------- write ---- */

const createTask: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const capabilityId = capabilityFor(ctx, args, 'operations');
  const task: Task = {
    ...base(ctx, 'task', title),
    title,
    notes: optText(args, 'notes'),
    status: enumArg(args, 'status', TASK_STATUSES, 'next'),
    priority: enumArg(args, 'priority', PRIORITIES, 'p2'),
    capabilityId,
    energy: enumArg(args, 'energy', ENERGY_COSTS, 'moderate'),
    estimateMinutes: argNumber(args, 'estimateMinutes'),
    dueDate: optText(args, 'dueDate'),
    goalId: optText(args, 'goalId'),
    source: 'assistant',
  };
  await insertRecords(ctx.scope, 'tasks', [task]);
  return ok(`Created task “${title}” under ${capabilityId}.`, [task.id]);
};

const updateTask: ToolExecutor = async (ctx, args) => {
  const taskId = argText(args, 'taskId');
  const tasks = await readCollection(ctx.scope, 'tasks');
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return missing(`Task ${taskId}`);

  const status = optEnum(args, 'status', TASK_STATUSES);
  const patch: Partial<Task> = {
    ...(status ? { status } : {}),
    // A task moved off `blocked` should not keep the reason it was blocked.
    ...(status && status !== 'blocked' ? { blockedReason: undefined } : {}),
    ...(optEnum(args, 'priority', PRIORITIES) ? { priority: optEnum(args, 'priority', PRIORITIES) } : {}),
    ...(optText(args, 'dueDate') ? { dueDate: optText(args, 'dueDate') } : {}),
    ...(argNumber(args, 'estimateMinutes') !== undefined
      ? { estimateMinutes: argNumber(args, 'estimateMinutes') }
      : {}),
    ...(optText(args, 'notes') ? { notes: optText(args, 'notes') } : {}),
    ...(optText(args, 'blockedReason') ? { blockedReason: optText(args, 'blockedReason') } : {}),
  };
  if (Object.keys(patch).length === 0) {
    return refuse('Nothing to change.', 'No new value was supplied for any field.');
  }

  await updateRecord(ctx.scope, 'tasks', taskId, patch);
  return ok(`Updated “${task.title}”: ${Object.keys(patch).join(', ')}.`, [taskId]);
};

const completeTask: ToolExecutor = async (ctx, args) => {
  const taskId = argText(args, 'taskId');
  const tasks = await readCollection(ctx.scope, 'tasks');
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return missing(`Task ${taskId}`);
  if (task.status === 'done') return ok(`“${task.title}” was already done.`, [taskId]);

  await updateRecord(ctx.scope, 'tasks', taskId, { status: 'done', completedAt: stampOf(ctx) });
  return ok(`Completed “${task.title}”.`, [taskId]);
};

const createGoal: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const capabilityId = capabilityFor(ctx, args, 'strategy');
  const goal: Goal = {
    ...base(ctx, 'goal', title),
    title,
    description: optText(args, 'description'),
    horizon: enumArg(args, 'horizon', GOAL_HORIZONS, 'quarter'),
    status: 'on-track',
    // A goal created today has no evidence of progress. Zero is the measurement,
    // not a placeholder for one.
    progress: 0,
    targetDate: optText(args, 'targetDate'),
    capabilityId,
    why: optText(args, 'why'),
  };
  await insertRecords(ctx.scope, 'goals', [goal]);
  return ok(`Created the ${goal.horizon} goal “${title}” under ${capabilityId}.`, [goal.id]);
};

const updateGoal: ToolExecutor = async (ctx, args) => {
  const goalId = argText(args, 'goalId');
  const goals = await readCollection(ctx.scope, 'goals');
  const goal = goals.find((candidate) => candidate.id === goalId);
  if (!goal) return missing(`Goal ${goalId}`);

  const status = optEnum(args, 'status', GOAL_STATUSES);
  const progress = argNumber(args, 'progress');
  const targetDate = optText(args, 'targetDate');
  const patch: Partial<Goal> = {
    ...(status ? { status } : {}),
    ...(progress !== undefined ? { progress: clamp01(progress) } : {}),
    ...(targetDate ? { targetDate } : {}),
  };
  if (Object.keys(patch).length === 0) {
    return refuse('Nothing to change.', 'No new status, progress or target date was supplied.');
  }

  await updateRecord(ctx.scope, 'goals', goalId, patch);
  return ok(`Updated goal “${goal.title}”: ${Object.keys(patch).join(', ')}.`, [goalId]);
};

const addKpi: ToolExecutor = async (ctx, args) => {
  const label = argText(args, 'label');
  const value = argNumber(args, 'value');
  if (value === undefined) return refuse('No reading supplied.', 'A KPI needs a first reading.');

  const format = enumArg(args, 'format', KPI_FORMATS, 'number');
  const currency = optEnum(args, 'currency', CURRENCIES) ?? (format === 'money' ? 'CHF' : undefined);
  const kpi: Kpi = {
    ...base(ctx, 'kpi', label),
    label,
    value,
    target: argNumber(args, 'target'),
    format,
    currency,
    direction: enumArg(args, 'direction', KPI_DIRECTIONS, 'up-good'),
    capabilityId: capabilityFor(ctx, args, 'executive'),
    // One reading is one point. History is never back-filled: an invented series
    // is indistinguishable from a measured one once it is on the rail.
    series: [value],
    period: argText(args, 'period', 'current'),
  };
  await insertRecords(ctx.scope, 'kpis', [kpi]);
  return ok(`Now tracking “${label}” at ${value} under ${kpi.capabilityId}.`, [kpi.id]);
};

/** Readings kept on the rail. Older points fall off rather than compressing. */
const KPI_SERIES_LIMIT = 24;

const recordKpiValue: ToolExecutor = async (ctx, args) => {
  const kpiId = argText(args, 'kpiId');
  const value = argNumber(args, 'value');
  if (value === undefined) return refuse('No reading supplied.', 'A reading needs a value.');

  const kpis = await readCollection(ctx.scope, 'kpis');
  const kpi = kpis.find((candidate) => candidate.id === kpiId);
  if (!kpi) return missing(`KPI ${kpiId}`);

  const period = optText(args, 'period');
  await updateRecord(ctx.scope, 'kpis', kpiId, {
    previousValue: kpi.value,
    value,
    series: [...kpi.series, value].slice(-KPI_SERIES_LIMIT),
    ...(period ? { period } : {}),
  });
  return ok(`Recorded ${value} against “${kpi.label}” (was ${kpi.value}).`, [kpiId]);
};

const writeDoc: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const capabilityId = capabilityFor(ctx, args, 'operations');
  const doc: KnowledgeDoc = {
    ...base(ctx, 'doc', title),
    title,
    body: argText(args, 'body'),
    kind: enumArg(args, 'kind', DOC_KINDS, 'doc'),
    capabilityId,
    tags: listArg(args, 'tags'),
    source: 'assistant',
  };
  await insertRecords(ctx.scope, 'docs', [doc]);
  return ok(`Wrote the ${doc.kind} “${title}” into ${capabilityId}.`, [doc.id]);
};

const addRoadmapItem: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const confidence = argNumber(args, 'confidence');
  const item: RoadmapItem = {
    ...base(ctx, 'road', title),
    title,
    summary: optText(args, 'summary'),
    stage: enumArg(args, 'stage', ROADMAP_STAGES, 'idea'),
    horizon: argText(args, 'horizon', 'unscheduled'),
    capabilityId: capabilityFor(ctx, args, 'development'),
    confidence: clamp01(confidence ?? 0.5),
  };
  await insertRecords(ctx.scope, 'roadmap', [item]);
  return ok(`Added “${title}” to the roadmap at stage ${item.stage} (${item.horizon}).`, [item.id]);
};

const addRisk: ToolExecutor = async (ctx, args) => {
  const label = argText(args, 'label');
  const risk: RiskItem = {
    ...base(ctx, 'risk', label),
    label,
    detail: argText(args, 'detail'),
    severity: enumArg(args, 'severity', SEVERITIES, 'medium'),
    capabilityId: capabilityFor(ctx, args, 'strategy'),
    mitigation: optText(args, 'mitigation'),
    kind: enumArg(args, 'kind', ['risk', 'bottleneck'] as const, 'risk'),
  };
  await insertRecords(ctx.scope, 'risks', [risk]);
  return ok(`Recorded the ${risk.severity} ${risk.kind} “${label}”.`, [risk.id]);
};

const addContact: ToolExecutor = async (ctx, args) => {
  const name = argText(args, 'name');
  const amountMinor = argNumber(args, 'amountMinor');
  const contact: Contact = {
    ...base(ctx, 'contact', name),
    name,
    organisation: optText(args, 'organisation'),
    role: optText(args, 'role'),
    stage: enumArg(args, 'stage', CRM_STAGES, 'lead'),
    // No figure means no figure. A zero-value deal would sum into the pipeline
    // total as if it had been quoted.
    value:
      amountMinor === undefined
        ? undefined
        : { amount: Math.round(amountMinor), currency: enumArg(args, 'currency', CURRENCIES, 'CHF') },
    notes: optText(args, 'notes'),
  };
  await insertRecords(ctx.scope, 'contacts', [contact]);
  return ok(`Added ${name} to the pipeline at stage ${contact.stage}.`, [contact.id]);
};

const logContactTouch: ToolExecutor = async (ctx, args) => {
  const contactId = argText(args, 'contactId');
  const contacts = await readCollection(ctx.scope, 'contacts');
  const contact = contacts.find((candidate) => candidate.id === contactId);
  if (!contact) return missing(`Contact ${contactId}`);

  const at = stampOf(ctx);
  const note = optText(args, 'note');
  const stage = optEnum(args, 'stage', CRM_STAGES);
  const nextTouchAt = optText(args, 'nextTouchAt');

  await updateRecord(ctx.scope, 'contacts', contactId, {
    lastTouchAt: at,
    ...(nextTouchAt ? { nextTouchAt } : {}),
    ...(stage ? { stage } : {}),
    // Appended, never replaced: the previous note is the history of the relationship.
    ...(note ? { notes: contact.notes ? `${contact.notes}\n\n${at.slice(0, 10)}: ${note}` : note } : {}),
  });
  return ok(
    `Logged a touch with ${contact.name}${stage ? `, moved to ${stage}` : ''}${nextTouchAt ? `, next follow-up ${nextTouchAt}` : ''}.`,
    [contactId],
  );
};

const addFinanceEntry: ToolExecutor = async (ctx, args) => {
  const amountMinor = argNumber(args, 'amountMinor');
  if (amountMinor === undefined) {
    return refuse('No amount supplied.', 'A ledger entry needs an amount in integer minor units.');
  }
  const label = argText(args, 'label');
  const entry: FinanceEntry = {
    ...base(ctx, 'fin', `${label}:${amountMinor}`),
    date: argText(args, 'date'),
    direction: enumArg(args, 'direction', FINANCE_DIRECTIONS, 'out'),
    amount: { amount: Math.round(amountMinor), currency: enumArg(args, 'currency', CURRENCIES, 'CHF') },
    category: argText(args, 'category', 'uncategorised'),
    label,
    confidence: enumArg(args, 'confidence', FINANCE_CONFIDENCE, 'actual'),
    recurring: argFlag(args, 'recurring'),
    counterparty: optText(args, 'counterparty'),
  };
  await insertRecords(ctx.scope, 'finance', [entry]);
  // The receipt is read by a human: "CHF 49.90 out", never "CHF 4990 minor
  // units" — and never rounded, because a receipt that rounds is a wrong receipt.
  return ok(
    `Recorded ${formatMinorAmount(entry.amount.amount, entry.amount.currency, { exact: true })} ${entry.direction} on ${entry.date} as “${label}”.`,
    [entry.id],
  );
};

const createAutomation: ToolExecutor = async (ctx, args) => {
  const name = argText(args, 'name');
  const capabilityId = capabilityFor(ctx, args, 'automation');
  const specialistId = getCapability(capabilityId)?.specialistIds[0] ?? 'chief-of-staff';

  // Every step is local. An assistant that could write `external: true` would be
  // granting itself outside reach by creating a record, which is exactly the
  // gate this system exists to keep shut.
  const steps: AutomationStep[] = listArg(args, 'steps').map((label, index) => ({
    id: newId(ctx, 'step', `${name}:${index}:${label}`),
    label,
    specialistId,
    external: false,
  }));

  const automation: Automation = {
    ...base(ctx, 'auto', name),
    name,
    description: argText(args, 'description'),
    capabilityId,
    // Draft, never armed. Arming is a separate decision the founder makes.
    status: 'draft',
    trigger: enumArg(args, 'trigger', AUTOMATION_TRIGGERS, 'manual'),
    triggerDetail: argText(args, 'triggerDetail', 'on request'),
    steps,
    runsThisMonth: 0,
    // Claims nothing until a run has actually stood in for something.
    minutesSavedPerRun: Math.max(0, Math.round(argNumber(args, 'minutesSavedPerRun') ?? 0)),
    requiresApproval: false,
  };
  await insertRecords(ctx.scope, 'automations', [automation]);
  return ok(
    `Drafted the automation “${name}” with ${steps.length} local step${steps.length === 1 ? '' : 's'}. It is a draft and cannot reach outside OmniOS.`,
    [automation.id],
  );
};

const setAutomationStatus: ToolExecutor = async (ctx, args) => {
  const automationId = argText(args, 'automationId');
  const automations = await readCollection(ctx.scope, 'automations');
  const automation = automations.find((candidate) => candidate.id === automationId);
  if (!automation) return missing(`Automation ${automationId}`);

  const status = enumArg(args, 'status', ['armed', 'paused'] as const, 'paused');
  if (automation.status === status) return ok(`“${automation.name}” is already ${status}.`, [automationId]);

  await updateRecord(ctx.scope, 'automations', automationId, { status });
  return ok(
    `Set “${automation.name}” to ${status}. It still cannot act outside OmniOS without your approval.`,
    [automationId],
  );
};

const createBrief: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const formats = listArg(args, 'formats').filter((value): value is (typeof ASSET_KINDS)[number] =>
    (ASSET_KINDS as readonly string[]).includes(value),
  );
  const brief: CreativeBrief = {
    ...base(ctx, 'brief', title),
    title,
    objective: argText(args, 'objective'),
    audience: argText(args, 'audience'),
    keyMessage: argText(args, 'keyMessage'),
    mustInclude: listArg(args, 'mustInclude'),
    mustAvoid: listArg(args, 'mustAvoid'),
    formats,
    toneOverride: optText(args, 'toneOverride'),
    channel: optText(args, 'channel'),
  };
  await insertRecords(ctx.scope, 'briefs', [brief]);
  return ok(
    `Created the brief “${title}” for ${brief.audience}${formats.length > 0 ? ` (${formats.join(', ')})` : ''}. No asset was generated.`,
    [brief.id],
  );
};

const remember: ToolExecutor = async (ctx, args) => {
  const text = argText(args, 'text');
  const strength = argNumber(args, 'strength');
  // Embedded on write, when a provider exists. Doing it here rather than in a
  // batch job means a memory is retrievable the moment it is made, and a
  // workspace with no embedding key simply stores none — `recallMemory` ranks
  // lexically until every record has one, so there is no half-migrated state
  // where some records are findable and others silently are not.
  const vector = (await embedTexts([text]))?.vectors[0];

  const record: MemoryRecord = {
    ...base(ctx, 'mem', text),
    kind: enumArg(args, 'kind', MEMORY_KINDS, 'fact'),
    text,
    capabilityId: capabilityFor(ctx, args, 'executive'),
    strength: clamp01(strength ?? 0.6),
    tags: listArg(args, 'tags'),
    source: 'assistant',
    useCount: 0,
    ...(vector ? { embedding: vector } : {}),
  };
  // Written into this scope only. Reaching shared capability memory needs
  // promoteMemory and the gate it runs — never a tool call.
  await insertRecords(ctx.scope, 'memory', [record]);
  return ok(`Remembered, as a ${record.kind} in this space only: “${text}”.`, [record.id]);
};

const HEALTH_FIELDS = [
  'sleepHours',
  'sleepQuality',
  'restingHeartRate',
  'hrv',
  'steps',
  'workoutMinutes',
  'stress',
  'mood',
] as const;

const logHealthDay: ToolExecutor = async (ctx, args) => {
  const date = argText(args, 'date');
  const readings: Partial<Record<(typeof HEALTH_FIELDS)[number], number>> = {};
  for (const field of HEALTH_FIELDS) {
    const value = argNumber(args, field);
    if (value !== undefined) readings[field] = value;
  }
  const workoutKind = optText(args, 'workoutKind');
  const notes = optText(args, 'notes');

  if (Object.keys(readings).length === 0 && !workoutKind && !notes) {
    return refuse('Nothing to record.', 'No reading was supplied for that day.');
  }

  const days = await readCollection(ctx.scope, 'health');
  const existing = days.find((day) => day.date === date);

  // `energy` is left unset on purpose. `energyOf` derives it at read time from
  // whatever is actually present, and returns null when there is too little —
  // storing a number here would freeze a guess into the record.
  const patch = {
    ...readings,
    ...(workoutKind ? { workoutKind } : {}),
    ...(notes ? { notes } : {}),
  };

  if (existing) {
    await updateRecord(ctx.scope, 'health', existing.id, patch);
    return ok(`Updated ${date}: ${Object.keys(patch).join(', ')}.`, [existing.id]);
  }

  const day: HealthDay = { ...base(ctx, 'health', date), date, ...patch };
  await insertRecords(ctx.scope, 'health', [day]);
  return ok(`Recorded ${date}: ${Object.keys(patch).join(', ')}.`, [day.id]);
};

const addHabit: ToolExecutor = async (ctx, args) => {
  const name = argText(args, 'name');
  const target = argNumber(args, 'targetPerWeek');
  const habit: Habit = {
    ...base(ctx, 'habit', name),
    name,
    cadence: enumArg(args, 'cadence', HABIT_CADENCES, 'daily'),
    intent: argText(args, 'intent'),
    completions: [],
    targetPerWeek: Math.max(1, Math.min(7, Math.round(target ?? 5))),
    archived: false,
  };
  await insertRecords(ctx.scope, 'habits', [habit]);
  return ok(`Tracking the habit “${name}” (${habit.cadence}, ${habit.targetPerWeek}× a week).`, [habit.id]);
};

const completeHabit: ToolExecutor = async (ctx, args) => {
  const habitId = argText(args, 'habitId');
  const habits = await readCollection(ctx.scope, 'habits');
  const habit = habits.find((candidate) => candidate.id === habitId);
  if (!habit) return missing(`Habit ${habitId}`);

  const date = argText(args, 'date', dayOf(ctx));
  if (habit.completions.includes(date)) {
    return ok(`“${habit.name}” was already recorded for ${date}.`, [habitId]);
  }

  await updateRecord(ctx.scope, 'habits', habitId, {
    completions: [date, ...habit.completions].sort().reverse(),
  });
  return ok(`Recorded “${habit.name}” as kept on ${date}.`, [habitId]);
};

const addRelationship: ToolExecutor = async (ctx, args) => {
  const name = argText(args, 'name');
  const cadenceDays = argNumber(args, 'cadenceDays');
  const person: Relationship = {
    ...base(ctx, 'rel', name),
    name,
    circle: enumArg(args, 'circle', RELATIONSHIP_CIRCLES, 'friends'),
    relation: optText(args, 'relation'),
    cadenceDays: Math.max(1, Math.round(cadenceDays ?? 30)),
    nextIntent: optText(args, 'nextIntent'),
    notes: optText(args, 'notes'),
  };
  await insertRecords(ctx.scope, 'relationships', [person]);
  return ok(`Added ${name} to the ${person.circle} circle, every ${person.cadenceDays} days.`, [person.id]);
};

const scheduleBlock: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const startMinute = argNumber(args, 'startMinute');
  if (startMinute === undefined) {
    return refuse('No start time supplied.', 'A block needs a start expressed in minutes past midnight.');
  }
  const block: CalendarBlock = {
    ...base(ctx, 'block', title),
    title,
    date: argText(args, 'date'),
    startMinute: Math.max(0, Math.min(1439, Math.round(startMinute))),
    durationMinutes: Math.max(5, Math.round(argNumber(args, 'durationMinutes') ?? 60)),
    kind: enumArg(args, 'kind', CALENDAR_BLOCK_KINDS, 'deep-work'),
    spaceKey: scopeKey(ctx.scope),
  };
  await insertRecords(ctx.scope, 'calendar', [block]);
  return ok(
    `Blocked ${block.durationMinutes} minutes on ${block.date} for “${title}”. Nothing was written to an external calendar.`,
    [block.id],
  );
};

const addLifeAdmin: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const item: LifeAdminItem = {
    ...base(ctx, 'admin', title),
    title,
    kind: enumArg(args, 'kind', LIFE_ADMIN_KINDS, 'admin'),
    dueDate: optText(args, 'dueDate'),
    status: 'open',
    detail: optText(args, 'detail'),
    location: optText(args, 'location'),
  };
  await insertRecords(ctx.scope, 'lifeAdmin', [item]);
  return ok(`Added the ${item.kind} item “${title}”.`, [item.id]);
};

function decideSuggestion(next: 'accepted' | 'dismissed'): ToolExecutor {
  return async (ctx, args) => {
    const suggestionId = argText(args, 'suggestionId');
    const suggestions = await readCollection(ctx.scope, 'suggestions');
    const suggestion = suggestions.find((candidate) => candidate.id === suggestionId);
    if (!suggestion) return missing(`Suggestion ${suggestionId}`);
    if (suggestion.status === next) return ok(`Already ${next}.`, [suggestionId]);

    await updateRecord(ctx.scope, 'suggestions', suggestionId, { status: next });
    return ok(
      `Marked “${suggestion.title}” as ${next}${next === 'accepted' ? '. Nothing it proposes was carried out.' : '.'}`,
      [suggestionId],
    );
  };
}

/* ---------------------------------------------------------- destructive --- */

const deleteRecord: ToolExecutor = async (ctx, args) => {
  const collection = argText(args, 'collection') as DeletableCollection;
  if (!(DELETABLE_COLLECTIONS as readonly string[]).includes(collection)) {
    return refuse(
      `${collection} cannot be deleted from.`,
      'That collection is part of the audit trail and is not deletable.',
    );
  }
  const recordId = argText(args, 'recordId');
  const records: ReadonlyArray<{ id: string }> = await readCollection(ctx.scope, collection);
  if (!records.some((record) => record.id === recordId)) return missing(`Record ${recordId}`);

  await removeRecord(ctx.scope, collection, recordId);
  return ok(`Deleted ${recordId} from ${collection}. This cannot be undone.`, [recordId]);
};

const resetCapabilityData: ToolExecutor = async (ctx, args) => {
  const kind = spaceKindOf(ctx);
  if (!kind) return refuse('Not a resettable scope.', 'Shared capability memory holds no runnable records.');

  const capabilityId = argText(args, 'capabilityId');
  if (!capabilitiesFor(kind).some((c) => c.id === capabilityId)) {
    return refuse(`${capabilityId} is not a capability of this space.`, 'Unknown capability.');
  }

  const removed: string[] = [];
  await mutateScope(ctx.scope, (data) => {
    const next: ScopeData = { ...data };
    // One predicate over ten differently-typed collections. The cast is the price
    // of not writing the same three lines ten times; every collection listed is
    // checked against `CollectionName` where the list is declared.
    const bag = next as unknown as Record<string, Array<{ id: string; capabilityId?: string }>>;
    for (const name of CAPABILITY_SCOPED_COLLECTIONS) {
      const before = bag[name] ?? [];
      for (const record of before) {
        if (record.capabilityId === capabilityId) removed.push(record.id);
      }
      bag[name] = before.filter((record) => record.capabilityId !== capabilityId);
    }
    return next;
  });

  return ok(
    `Deleted ${removed.length} ${capabilityId} record${removed.length === 1 ? '' : 's'} across ${CAPABILITY_SCOPED_COLLECTIONS.length} collections. The evolution log was left intact. This cannot be undone.`,
    removed,
  );
};

/* -------------------------------------------------------------- external -- */

/**
 * V1 wires no outbound provider.
 *
 * These executors refuse rather than simulating success, and they refuse *before*
 * touching `ctx.resolveSecrets` — a call that will not happen has no reason to
 * decrypt a credential. The tools exist so the approval path is real: the gate,
 * the preview, the recorded decision and the refusal are all exercised end to end.
 */
/**
 * Tools that exist to prove the gate and refuse to act.
 *
 * Exported so the assistant can be told not to offer them. A capability the
 * system lists but cannot perform is worse than one it never mentions.
 */
export const NOT_WIRED_TOOL_IDS = ['send_email', 'publish_post', 'call_webhook'] as const;

function notWired(what: string, provider: string): ToolExecutor {
  return async () => ({
    ok: false,
    summary: `Refused: ${what} was approved but not performed.`,
    error: `No ${provider} is wired in this build. OmniOS will not claim to have done something it did not do. Nothing left this machine, and no credential was decrypted.`,
    affectedIds: [],
  });
}

/* ------------------------------------------------------------ the table --- */

/**
 * Typed as `Record<ToolId, ToolExecutor>`, so a tool added to the registry
 * without an executor is a compile error rather than a runtime surprise on the
 * day a founder first reaches for it.
 */
/* ------------------------------------------------------------- reading ---- */

/**
 * The text fields worth matching, across every record shape.
 *
 * Records do not share a base beyond `ScopedRecord`, so search is
 * shape-tolerant rather than typed per collection: it looks at the handful of
 * fields that carry human words and ignores the rest. A field that does not
 * exist on a given record is simply absent, which is what makes one function
 * work across twenty collections without knowing any of them.
 */
const SEARCHABLE_FIELDS = [
  'title', 'name', 'label', 'text', 'summary', 'detail', 'notes',
  'description', 'question', 'intent', 'note', 'body',
] as const;

function searchableText(record: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const field of SEARCHABLE_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value) parts.push(value);
  }
  return parts.join(' ').toLowerCase();
}

/** One line per hit, carrying the id — the only handle `get_record` accepts. */
function describeHit(collection: string, record: Readonly<Record<string, unknown>>): string {
  const label =
    ['title', 'name', 'label', 'text', 'summary'].map((f) => record[f]).find((v) => typeof v === 'string' && v) ??
    '(untitled)';
  const status = typeof record['status'] === 'string' ? ` · ${record['status']}` : '';
  return `${collection} ${String(record['id'])} — ${String(label).slice(0, 120)}${status}`;
}

const searchWorkspace: ToolExecutor = async (ctx, args) => {
  const query = argText(args, 'query').toLowerCase().trim();
  if (!query) return refuse('Nothing to search for.', 'A search needs at least one word.');

  const only = optText(args, 'collection');
  const limit = Math.min(Math.max(argNumber(args, 'limit') ?? 10, 1), 40);
  const collections = only
    ? [only]
    : (SEARCHABLE_COLLECTIONS as readonly string[]);

  const words = query.split(/\s+/).filter(Boolean);
  const hits: string[] = [];

  for (const collection of collections) {
    const records = (await readCollection(
      ctx.scope,
      collection as Parameters<typeof readCollection>[1],
    )) as unknown as ReadonlyArray<Record<string, unknown>>;

    for (const record of records) {
      const haystack = searchableText(record);
      // Every word must appear. An OR would return the whole workspace for a
      // two-word question, which is the same as returning nothing useful.
      if (!words.every((word) => haystack.includes(word))) continue;
      hits.push(describeHit(collection, record));
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }

  return ok(
    hits.length === 0
      ? `Nothing in this space matches “${query}”.`
      : `${hits.length} match${hits.length === 1 ? '' : 'es'} for “${query}”:\n${hits.join('\n')}`,
  );
};

const getRecord: ToolExecutor = async (ctx, args) => {
  const collection = argText(args, 'collection');
  const recordId = argText(args, 'recordId');

  const records = (await readCollection(
    ctx.scope,
    collection as Parameters<typeof readCollection>[1],
  )) as unknown as ReadonlyArray<Record<string, unknown>>;
  const found = records.find((record) => record['id'] === recordId);

  if (!found) {
    // Named plainly rather than as an error: an id that is not here is a fact
    // about this space, and the assistant should say so and move on.
    return ok(`No ${collection} record with id ${recordId} exists in this space.`);
  }

  const readable = Object.entries(found)
    .filter(([key, value]) => key !== 'scope' && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join('\n');

  return ok(`${collection} ${recordId}\n${readable}`);
};



/* ------------------------------------------------- founder-level verbs ---- */

/**
 * These do what a Server Action does, without importing one.
 *
 * `lib/ai/` may not import `lib/actions/`, so an executor cannot call
 * `createCompany` and inherit its validation. It calls the same generator and
 * the same store instead — the action stays the UI's path, this is the
 * assistant's, and both end at the same records. What the action adds and this
 * deliberately does not is `redirect`: a tool that navigated the founder
 * somewhere mid-conversation would be acting on the browser, not the workspace.
 */
const createCompanyTool: ToolExecutor = async (ctx, args) => {
  const name = argText(args, 'name');
  if (name.length < 2) return refuse('A company needs a name.', 'The name was empty.');

  const goals = optText(args, 'goals');
  const draft = {
    name,
    description: optText(args, 'description') || `${name} — description not written yet.`,
    industry: optText(args, 'industry') || 'Unspecified',
    mission: optText(args, 'mission') || `Build ${name} into something worth relying on.`,
    vision: `${name}, operating without needing to be watched.`,
    businessModel: optText(args, 'businessModel') || 'Not decided yet.',
    goals: (goals ?? '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6),
    stage: enumArg(args, 'stage', COMPANY_STAGES, 'idea'),
  };

  const { company, data } = generateCompanyWorkspace(
    { ...draft, baseCurrency: 'CHF' } as Parameters<typeof generateCompanyWorkspace>[0],
    ctx.now,
  );

  const workspace = await getWorkspace();
  // By name, not by id. A company id is derived from name *and* industry, so
  // "Reelworks / Media" and "Reelworks / Unspecified" are different ids — an
  // id check lets the assistant quietly create a second company the founder
  // would call the same thing. Name is what they mean by "already exists".
  const clash = workspace.companies.find(
    (existing) => existing.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (clash) {
    return refuse(
      `${name} already exists.`,
      `A company called “${clash.name}” is already in this workspace${clash.archivedAt ? ' (archived)' : ''}.`,
    );
  }

  // Scope data first: if this dies between the two writes, an orphaned scope
  // file is harmless, whereas a company with no headquarters is not.
  await writeScopeData(companyScope(company.id), data);
  await saveWorkspace((current) => ({ ...current, companies: [...current.companies, company] }));

  return ok(
    `Created ${company.name} with a full headquarters. Open it at /companies/${company.id}.`,
    [company.id],
  );
};

const hireAgentTool: ToolExecutor = async (ctx, args) => {
  const kind = spaceKindOf(ctx);
  if (!kind) return refuse('Agents are hired into a company or your life.', 'Shared memory has no roster.');

  const preset = getPreset(argText(args, 'presetId'));
  if (!preset) return refuse('That preset does not exist.', `No agent preset called “${argText(args, 'presetId')}”.`);
  if (!preset.allowedScopeKinds.includes(kind)) {
    return refuse(
      `${preset.name} does not work in a ${kind} space.`,
      `${preset.name} is only available in: ${preset.allowedScopeKinds.join(', ')}.`,
    );
  }

  const name = optText(args, 'name') || preset.name;
  const id = agentIdFrom(name);
  const existing = await readCollection(ctx.scope, 'customAgents');
  if (existing.some((agent) => agent.id === id)) {
    return refuse(`${name} is already on this roster.`, 'Hiring the same agent twice would shadow the first.');
  }

  const agent: CustomAgent = {
    ...base(ctx, 'agent', name),
    id,
    name,
    domain: preset.domain,
    role: preset.role,
    charter: preset.charter,
    capabilityIds: [...preset.capabilityIds],
    matches: [...preset.matches],
    toolIds: [...preset.toolIds],
    allowedScopeKinds: [...preset.allowedScopeKinds],
    wouldDo: [...preset.wouldDo],
    presetId: preset.id,
    overridesBuiltIn: false,
    enabled: true,
    createdBy: 'assistant',
  };
  await insertRecords(ctx.scope, 'customAgents', [agent]);

  return ok(`Hired ${name} into this space. They join the roster and can be switched off again.`, [id]);
};

const openMeetingTool: ToolExecutor = async (ctx, args) => {
  const kind = spaceKindOf(ctx);
  if (!kind) return refuse('Meetings happen in a company or your life.', 'Shared memory holds no meetings.');

  const topic = argText(args, 'topic').slice(0, 200);
  if (topic.length < 3) return refuse('Give the meeting a topic.', 'The topic was empty.');

  const participants = recommendParticipants(topic, kind, await rosterFor(ctx.scope));
  const meeting = newMeeting(ctx.scope, topic, participants.map((s) => s.id), ctx.now);
  await insertRecords(ctx.scope, 'meetings', [meeting]);

  return ok(
    `Opened a meeting on “${topic}” with ${participants.map((s) => s.name).join(', ')}. Nothing they plan runs until you approve it.`,
    [meeting.id],
  );
};

const EXECUTORS: Record<ToolId, ToolExecutor> = {
  create_company: createCompanyTool,
  hire_agent: hireAgentTool,
  open_meeting: openMeetingTool,
  search_workspace: searchWorkspace,
  get_record: getRecord,
  create_task: createTask,
  update_task: updateTask,
  complete_task: completeTask,
  create_goal: createGoal,
  update_goal: updateGoal,
  add_kpi: addKpi,
  record_kpi_value: recordKpiValue,
  write_doc: writeDoc,
  add_roadmap_item: addRoadmapItem,
  add_risk: addRisk,
  add_contact: addContact,
  log_contact_touch: logContactTouch,
  add_finance_entry: addFinanceEntry,
  create_automation: createAutomation,
  set_automation_status: setAutomationStatus,
  create_brief: createBrief,
  remember,
  log_health_day: logHealthDay,
  add_habit: addHabit,
  complete_habit: completeHabit,
  add_relationship: addRelationship,
  schedule_block: scheduleBlock,
  add_life_admin: addLifeAdmin,
  accept_suggestion: decideSuggestion('accepted'),
  dismiss_suggestion: decideSuggestion('dismissed'),
  delete_record: deleteRecord,
  reset_capability_data: resetCapabilityData,
  send_email: notWired('an email', 'email provider'),
  publish_post: notWired('a post', 'publishing channel'),
  call_webhook: notWired('a webhook call', 'outbound HTTP client'),
};

export function hasExecutor(toolId: string): boolean {
  return toolId in EXECUTORS || parseMcpToolId(toolId) !== null;
}


/* -------------------------------------------------------------- remote ---- */

/**
 * Resolve a tool id to a definition, including one that lives on a connection.
 *
 * Async because a remote tool's shape is not compiled in: it comes from the last
 * probe of the server that advertises it. Everything downstream — validation,
 * the smuggling check, the gate, the preview — then treats it exactly like a
 * built-in, which is the only reason adding MCP did not require a second gate.
 */
export async function resolveTool(toolId: string): Promise<ToolDefinition | undefined> {
  const local = getTool(toolId);
  if (local) return local;

  const parsed = parseMcpToolId(toolId);
  if (!parsed) return undefined;

  const workspace = await getWorkspace();
  const server = workspace.mcpServers.find((candidate) => candidate.id === parsed.serverId);
  if (!server || !server.enabled) return undefined;
  if (server.disabledTools.includes(parsed.toolName)) return undefined;

  const state = workspace.mcpStates.find((candidate) => candidate.serverId === parsed.serverId);
  const descriptor = state?.tools.find((candidate) => candidate.name === parsed.toolName);
  if (!descriptor) return undefined;

  return mcpToolDefinition(server, descriptor);
}

/**
 * Send a validated call to the server that advertised it.
 *
 * Placeholders are resolved here and nowhere earlier, so the `ToolCall` that was
 * already persisted carries `{{secret:NAME}}` while the transport carries the
 * value — which is invariant 6 in its most literal form.
 */
async function executeMcpTool(
  tool: ToolDefinition,
  ctx: ToolContext,
  args: ToolArgs,
): Promise<ToolOutcome> {
  const parsed = parseMcpToolId(tool.id);
  if (!parsed) return refuse(`${tool.label} is not a connection tool.`, 'Malformed remote tool id.');

  const workspace = await getWorkspace();
  const server = workspace.mcpServers.find((candidate) => candidate.id === parsed.serverId);
  if (!server) {
    return refuse(`${tool.label} has no connection.`, `No server called “${parsed.serverId}” is configured.`);
  }

  const payload: Record<string, unknown> = {};
  for (const param of tool.params) {
    const value = args[param.name];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const resolved = await ctx.resolveSecrets(value);
      // A `text` param is how a structured argument survives a flat form. If it
      // parses as JSON the server gets the structure it declared; if it does not,
      // it gets the string, because guessing would be worse than being literal.
      if (param.type === 'text') {
        try {
          payload[param.name] = JSON.parse(resolved) as unknown;
          continue;
        } catch {
          // Fall through to the string.
        }
      }
      payload[param.name] = resolved;
      continue;
    }
    payload[param.name] = value;
  }

  const result = await callMcpTool(server, parsed.toolName, payload);
  if (!result.ok) {
    return refuse(`${parsed.toolName} on ${server.name} failed.`, result.text || 'The server gave no reason.');
  }

  return ok(
    result.text
      ? `${parsed.toolName} on ${server.name} returned: ${result.text}`
      : `${parsed.toolName} on ${server.name} completed and returned nothing.`,
  );
}

/* ----------------------------------------------------------------- gate --- */

/** A decision a human actually made, recorded before a gated tool may run. */
export interface ToolApproval {
  readonly decidedBy: string;
  readonly decidedAt: Timestamp;
}

export interface RunToolOptions {
  /** Required for any tool where `requiresApproval(tool.risk)` is true. */
  readonly approval?: ToolApproval;
}

/**
 * The founder's own tightening of the gate, read from settings.
 *
 * Read here rather than passed in, so no caller can reach `runTool` with a
 * policy the founder never chose.
 */
async function approvalPolicy(): Promise<ApprovalPolicy> {
  const workspace = await getWorkspace();
  return { confirmWrites: workspace.settings.confirmWrites };
}

/**
 * Run a tool.
 *
 * The single entry point, and the only place the approval gate is consulted. It
 * checks, in order: the tool exists, the scope may run it, the arguments
 * validate, no secret placeholder is hiding in a parameter that has no business
 * carrying one, and — last — that a gated tier has a recorded human decision.
 */
export async function runTool(
  toolId: string,
  ctx: ToolContext,
  raw: Readonly<Record<string, unknown>>,
  options: RunToolOptions = {},
): Promise<ToolOutcome> {
  const tool = await resolveTool(toolId);
  if (!tool) {
    return refuse(
      `Unknown tool “${toolId}”.`,
      parseMcpToolId(toolId)
        ? 'That connection is missing, switched off, or has not been connected since the tool appeared.'
        : 'No tool with that id is declared.',
    );
  }

  const kind = spaceKindOf(ctx);
  if (!kind) {
    return refuse(
      `${tool.label} cannot run here.`,
      'Shared capability memory holds generalised lessons, never runnable records.',
    );
  }
  if (!tool.scopeKinds.includes(kind)) {
    return refuse(
      `${tool.label} does not apply to a ${kind} space.`,
      `${tool.label} is only available in: ${tool.scopeKinds.join(', ')}.`,
    );
  }

  const validation = validateArgs(tool, raw);
  if (!validation.ok) {
    return refuse(`${tool.label} was not run.`, validation.errors.join('; '));
  }

  const smuggled = smuggledSecretParams(tool, validation.coerced);
  if (smuggled.length > 0) {
    return refuse(
      `${tool.label} was not run.`,
      `A {{secret:…}} placeholder appeared in ${smuggled.join(', ')}, which does not accept one. A secret reference belongs only in a parameter declared to take it.`,
    );
  }

  if (requiresApproval(tool.risk, await approvalPolicy()) && !options.approval) {
    return refuse(
      `${tool.label} is waiting for your decision.`,
      `${tool.label} is ${tool.risk}. It does not run until a human decision is recorded against it.`,
    );
  }

  const remote = parseMcpToolId(tool.id) !== null;
  const executor = remote ? undefined : EXECUTORS[tool.id as ToolId];
  if (!remote && !executor) {
    return refuse(`${tool.label} has no executor.`, 'No executor is registered for that tool.');
  }

  let outcome: ToolOutcome;
  try {
    outcome = remote
      ? await executeMcpTool(tool, ctx, validation.coerced)
      : await executor!(ctx, validation.coerced);
  } catch (error) {
    outcome = refuse(
      `${tool.label} failed.`,
      error instanceof Error ? error.message : 'The executor threw a non-error value.',
    );
  }

  return scrub(tool, outcome);
}

function smuggledSecretParams(tool: ToolDefinition, args: ToolArgs): string[] {
  const offenders: string[] = [];
  for (const param of tool.params) {
    if (param.acceptsSecret) continue;
    const value = args[param.name];
    if (typeof value === 'string' && referencedSecretNames(value).length > 0) {
      offenders.push(param.name);
    }
  }
  return offenders;
}

/**
 * Last line of defence, not the first.
 *
 * Nothing should put plaintext into an outcome — executors resolve a secret,
 * use it, and drop it. But this outcome is about to be written into a `ToolCall`
 * and rendered, so for any tool that can hold a credential at all the text is
 * checked against the vault before it is returned.
 */
async function scrub(tool: ToolDefinition, outcome: ToolOutcome): Promise<ToolOutcome> {
  // Any remote call may carry a secret through an env var or a header that is
  // not a declared param, so a param-shape check misses those. Scrub every MCP
  // outcome; for built-ins, keep the cheap param gate.
  const remote = parseMcpToolId(tool.id) !== null;
  if (!remote && !tool.params.some((param) => param.acceptsSecret)) return outcome;

  const values = await allSecretValues();
  if (values.length === 0) return outcome;

  return {
    ...outcome,
    summary: redact(outcome.summary, values),
    ...(outcome.error ? { error: redact(outcome.error, values) } : {}),
  };
}
