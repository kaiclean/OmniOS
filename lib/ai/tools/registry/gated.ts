/**
 * The two gated tiers: `destructive` (delete, reset) and `external` (declared
 * but not wired).
 *
 * Every entry here stops for a recorded human decision; `runTool` enforces it,
 * not this data. They stay in one file so a reviewer can see every tool that
 * deletes or leaves the machine at once.
 */

import type { ToolArgs, ToolDefinition } from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import { EMPTY } from '@/lib/format';
import { argText, quoted, BOTH } from './shared';
import { DELETABLE_COLLECTIONS, CAPABILITY_SCOPED_COLLECTIONS } from './collections';

export const GATED_TOOLS = [
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
    matches: ['reset the capability', 'reset', 'capability data', 'wipe marketing', 'clear everything in', 'start that section over', 'delete all the data for'],
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
