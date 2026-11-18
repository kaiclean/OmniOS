/**
 * The founder-level verbs, the read tools, and the work tools (tasks, goals,
 * KPIs, docs, roadmap, risks).
 *
 * Data only. `risk` is the gate tier and `preview` is the promise rendered
 * before anything runs; both are exactly as they were in the single catalogue.
 */

import {
  COMPANY_STAGES,
  CURRENCIES,
  DOC_KINDS,
  ENERGY_COSTS,
  GOAL_HORIZONS,
  GOAL_STATUSES,
  KPI_DIRECTIONS,
  KPI_FORMATS,
  PRIORITIES,
  ROADMAP_STAGES,
  SEVERITIES,
  TASK_STATUSES,
  type ToolArgs,
  type ToolDefinition,
} from '@/lib/domain';
import { AGENT_PRESET_IDS } from '@/lib/ai/agent-presets';
import { capabilityIds } from '@/lib/capabilities/registry';
import { EMPTY } from '@/lib/format';
import { argText, argNumber, say, quoted, money, BOTH } from './shared';
import { SEARCHABLE_COLLECTIONS } from './collections';

export const CORE_TOOLS = [
  /* ------------------------------------------------------------ work ------ */
  {
    /**
     * The first read-tier tools, and the reason the assistant was previously
     * unable to answer anything it had not been handed.
     *
     * `loadContext` assembles a fixed slice of the workspace before a turn
     * starts. Everything outside that slice was unreachable — the assistant
     * could create a task about a contract it could not look up, and had no way
     * to check whether one already existed. `read` is an autonomous tier, so
     * these run without an approval: looking at your own records changes
     * nothing, and a question that has to be approved is a question nobody asks.
     */
    /**
     * Founder-level verbs, and the reason the assistant read as helpless.
     *
     * Thirty-two tools covered records inside a space — tasks, goals, KPIs — and
     * not one covered the things a founder actually opens OmniOS to do. Asked to
     * create a company, it answered "there's no tool for that", which was true:
     * `createCompany` existed as a button and had no vocabulary. The same held
     * for hiring an agent, convening the room, and adding a connection. The
     * capability was there; the assistant simply could not reach it.
     *
     * These are `write`: they create records this workspace owns and nothing
     * leaves the machine. A new company is reversible — archive or delete it.
     */
    id: 'create_company',
    label: 'Create a company',
    description:
      'Spin up a whole company space — headquarters, capabilities, goals, and a generated starting workspace. Use when the founder describes a business they are starting or already running that has no space yet.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: [
      'create a company', 'new company', 'start a company', 'set up a company',
      'add a company', 'i am starting', 'spin up a company', 'launch a business',
    ],
    params: [
      { name: 'name', type: 'string', description: 'What the company is called.', required: true },
      { name: 'description', type: 'text', description: 'What it does, in one or two sentences.', required: false },
      { name: 'industry', type: 'string', description: 'The market it operates in.', required: false },
      { name: 'businessModel', type: 'text', description: 'How it makes money.', required: false },
      { name: 'mission', type: 'text', description: 'Why it exists.', required: false },
      { name: 'stage', type: 'enum', description: 'Where it is today.', required: false, enumValues: COMPANY_STAGES, default: 'idea' },
      { name: 'goals', type: 'text', description: 'Up to six starting goals, one per line.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Create the company ${quoted(args, 'name', 'untitled')} at stage ${argText(args, 'stage', 'idea')}, with a generated headquarters across every capability. Reversible — you can archive or delete it.`,
  },
  {
    id: 'hire_agent',
    label: 'Hire an agent',
    description:
      'Add a specialist to this space\u2019s roster from a preset, so it routes, speaks in the room and can be talked to directly. Hiring grants no new power: whatever it proposes stops at the same gate.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: [
      'hire an agent', 'hire a', 'add an agent', 'i need someone who', 'add a specialist',
      'bring in a', 'we need a', 'add to the team',
    ],
    params: [
      { name: 'presetId', type: 'enum', description: 'Which preset to hire.', required: true, enumValues: AGENT_PRESET_IDS },
      { name: 'name', type: 'string', description: 'What to call them. Defaults to the preset name.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Hire ${argText(args, 'presetId', 'an agent')} into this space${argText(args, 'name', '') ? ` as ${quoted(args, 'name', '')}` : ''}. They join the roster and can be switched off again; they gain no permissions.`,
  },
  {
    id: 'open_meeting',
    label: 'Open a meeting',
    description:
      'Convene the specialists this topic needs in this space\u2019s room. They answer from real records and can disagree; nothing they plan runs until the founder approves it.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: [
      'open a meeting', 'convene', 'hold a meeting', 'get the team together',
      'team room', 'ask the room', 'what does the team think',
    ],
    params: [
      { name: 'topic', type: 'string', description: 'What the meeting is about, in the founder\u2019s words.', required: true },
    ],
    preview: (args: ToolArgs) =>
      `Open a meeting in this space on ${quoted(args, 'topic', 'an unnamed topic')}. The right specialists are seated automatically; nothing they plan runs without your approval.`,
  },
  {
    id: 'search_workspace',
    label: 'Search this space',
    description:
      'Find records in this space by text. Use before creating something, to check whether it already exists, and whenever the founder refers to a record that is not already in front of you. Reads only: nothing changes.',
    risk: 'read',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['search for', 'find the', 'look up', 'do i already have', 'is there a', 'what do i have about'],
    params: [
      { name: 'query', type: 'string', description: 'Words to look for. Matched against titles, names, labels and body text.', required: true },
      {
        name: 'collection',
        type: 'enum',
        description: 'Narrow to one kind of record. Omit to search the useful ones.',
        required: false,
        enumValues: SEARCHABLE_COLLECTIONS,
      },
      { name: 'limit', type: 'number', description: 'How many to return. Defaults to 10.', required: false, default: 10 },
    ],
    preview: (args: ToolArgs) =>
      `Search ${argText(args, 'collection', 'this space')} for ${quoted(args, 'query', 'nothing')}. Reads only; nothing changes.`,
  },
  {
    id: 'get_record',
    label: 'Open a record',
    description:
      'Read one record in full by its id, when a search result or another record referenced it and you need the detail. Reads only: nothing changes.',
    risk: 'read',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['open the record', 'show me the record', 'read the record'],
    params: [
      { name: 'collection', type: 'enum', description: 'Which collection the record lives in.', required: true, enumValues: SEARCHABLE_COLLECTIONS },
      { name: 'recordId', type: 'string', description: 'The id, exactly as a search result gave it.', required: true },
    ],
    preview: (args: ToolArgs) =>
      `Open ${argText(args, 'collection', 'a record')} ${argText(args, 'recordId', EMPTY)} in this space. Reads only; nothing changes.`,
  },
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
] as const satisfies readonly ToolDefinition[];
