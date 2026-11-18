/**
 * Tools for contacts, finance entries, automations, creative briefs and memory.
 *
 * Data only; tiers and previews unchanged from the single catalogue.
 */

import {
  ASSET_KINDS,
  AUTOMATION_TRIGGERS,
  CRM_STAGES,
  CURRENCIES,
  FINANCE_CONFIDENCE,
  FINANCE_DIRECTIONS,
  MEMORY_KINDS,
  type ToolArgs,
  type ToolDefinition,
} from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import { EMPTY } from '@/lib/format';
import { argText, argFlag, quoted, money, BOTH } from './shared';

export const BUSINESS_TOOLS = [
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
] as const satisfies readonly ToolDefinition[];
