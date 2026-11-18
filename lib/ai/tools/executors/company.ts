import 'server-only';

/**
 * Executors for the company-space records: tasks, goals, KPIs, docs, roadmap,
 * risks, contacts, finance entries, automations, briefs and memory.
 *
 * All of these are `write` tier: they change only the scope named in `ctx`, so
 * they run without a per-call decision (unless the founder turned on
 * `confirmWrites`). They are never called from here; `runTool` in
 * `../executors.ts` is the sole caller and applies the gate first.
 */

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
  KPI_DIRECTIONS,
  KPI_FORMATS,
  MEMORY_KINDS,
  PRIORITIES,
  ROADMAP_STAGES,
  SEVERITIES,
  TASK_STATUSES,
  type Automation,
  type AutomationStep,
  type Contact,
  type CreativeBrief,
  type FinanceEntry,
  type Goal,
  type KnowledgeDoc,
  type Kpi,
  type MemoryRecord,
  type RiskItem,
  type RoadmapItem,
  type Task,
  type ToolExecutor,
} from '@/lib/domain';
import { insertRecords, readCollection, updateRecord } from '@/lib/data/store';
import { formatMinorAmount } from '@/lib/format';
import { embedTexts } from '@/lib/ai/embeddings';
import { getCapability } from '@/lib/capabilities/registry';
import { argFlag, argNumber, argText } from '../index';
import { ok, refuse, stampOf, newId, base, optText, enumArg, optEnum, listArg, clamp01, capabilityFor, missing } from './shared';

export const createTask: ToolExecutor = async (ctx, args) => {
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

export const updateTask: ToolExecutor = async (ctx, args) => {
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

export const completeTask: ToolExecutor = async (ctx, args) => {
  const taskId = argText(args, 'taskId');
  const tasks = await readCollection(ctx.scope, 'tasks');
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return missing(`Task ${taskId}`);
  if (task.status === 'done') return ok(`“${task.title}” was already done.`, [taskId]);

  await updateRecord(ctx.scope, 'tasks', taskId, { status: 'done', completedAt: stampOf(ctx) });
  return ok(`Completed “${task.title}”.`, [taskId]);
};

export const createGoal: ToolExecutor = async (ctx, args) => {
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

export const updateGoal: ToolExecutor = async (ctx, args) => {
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

export const addKpi: ToolExecutor = async (ctx, args) => {
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

export const recordKpiValue: ToolExecutor = async (ctx, args) => {
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

export const writeDoc: ToolExecutor = async (ctx, args) => {
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

export const addRoadmapItem: ToolExecutor = async (ctx, args) => {
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

export const addRisk: ToolExecutor = async (ctx, args) => {
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

export const addContact: ToolExecutor = async (ctx, args) => {
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

export const logContactTouch: ToolExecutor = async (ctx, args) => {
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

export const addFinanceEntry: ToolExecutor = async (ctx, args) => {
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

export const createAutomation: ToolExecutor = async (ctx, args) => {
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

export const setAutomationStatus: ToolExecutor = async (ctx, args) => {
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

export const createBrief: ToolExecutor = async (ctx, args) => {
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

export const remember: ToolExecutor = async (ctx, args) => {
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
