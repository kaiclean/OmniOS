'use server';

import { revalidatePath } from 'next/cache';

import type { AssistantMessage, CustomAgent, Scope, SpecialistDomain } from '@/lib/domain';
import { SPECIALIST_DOMAINS, agentIdFrom, makeRecordId, parseScopeKey } from '@/lib/domain';
import { insertRecords, readCollection, removeRecord, updateRecord } from '@/lib/data/store';
import { capabilityIds } from '@/lib/capabilities/registry';
import { getPreset } from '@/lib/ai/agent-presets';
import { getSpecialist } from '@/lib/ai/specialists';
import { agentChannel, directAgentReply } from '@/lib/ai/agent-chat';
import { describeLoop, runActLoop } from '@/lib/ai/loop';
import { activeProvider } from '@/lib/ai/providers';
import { rosterFor } from '@/lib/ai/roster';

/**
 * Hiring and managing the roster.
 *
 * Every agent is a scoped record: hired into one company or into life, never
 * globally. Nothing here touches the gate because an agent has no power of its
 * own — it only routes, speaks and proposes, and proposals still stop where
 * they always stop.
 */

function resolveScope(scopeKeyInput: string): Scope | null {
  const scope = parseScopeKey(scopeKeyInput);
  if (!scope || scope.kind === 'shared') return null;
  return scope;
}

export async function hireFromPreset(
  scopeKeyInput: string,
  presetId: string,
  customName?: string,
): Promise<{ ok: boolean; agentId?: string; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  if (!scope) return { ok: false, error: 'Agents are hired into a company or your life.' };

  const preset = getPreset(presetId);
  if (!preset) return { ok: false, error: 'That preset does not exist.' };

  const kind = scope.kind === 'company' ? 'company' : 'personal';
  if (!preset.allowedScopeKinds.includes(kind)) {
    return { ok: false, error: `${preset.name} does not work in a ${kind === 'company' ? 'company' : 'personal'} space.` };
  }

  const name = (customName ?? '').trim() || preset.name;
  const id = agentIdFrom(name);
  if (id.length < 2) return { ok: false, error: 'Give the agent a real name.' };

  const existing = await readCollection(scope, 'customAgents');
  if (existing.some((agent) => agent.id === id)) {
    return { ok: false, error: `“${name}” is already on this roster.` };
  }

  const at = new Date().toISOString();
  const record: CustomAgent = {
    id,
    scope,
    createdAt: at,
    updatedAt: at,
    name,
    domain: preset.domain,
    role: preset.role,
    charter: preset.charter,
    capabilityIds: preset.capabilityIds,
    matches: preset.matches,
    toolIds: preset.toolIds,
    allowedScopeKinds: [kind],
    wouldDo: preset.wouldDo,
    presetId: preset.id,
    overridesBuiltIn: getSpecialist(id) !== undefined,
    enabled: true,
    createdBy: 'founder',
  };
  await insertRecords(scope, 'customAgents', [record]);
  revalidatePath('/', 'layout');
  return { ok: true, agentId: id };
}

export async function hireCustomAgent(
  scopeKeyInput: string,
  form: {
    name: string;
    role: string;
    charter: string;
    domain: string;
    capabilityIds: readonly string[];
    matches: string;
  },
): Promise<{ ok: boolean; agentId?: string; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  if (!scope) return { ok: false, error: 'Agents are hired into a company or your life.' };

  const name = form.name.trim();
  const id = agentIdFrom(name);
  if (name.length < 3 || id.length < 2) return { ok: false, error: 'Give the agent a real name.' };
  if (form.role.trim().length < 3) return { ok: false, error: 'Say what the agent is for.' };
  if (form.charter.trim().length < 10) {
    return { ok: false, error: 'The charter is what the agent answers from — give it a real one.' };
  }

  const domain = SPECIALIST_DOMAINS.find((candidate) => candidate === form.domain);
  if (!domain) return { ok: false, error: 'Pick a domain from the list.' };

  const valid = new Set(capabilityIds());
  const chosen = form.capabilityIds.filter((capability) => valid.has(capability));
  if (chosen.length === 0) return { ok: false, error: 'Pick at least one capability the agent may read.' };

  const matches = form.matches
    .split(',')
    .map((phrase) => phrase.trim().toLowerCase())
    .filter((phrase) => phrase.length > 1)
    .slice(0, 20);
  if (matches.length === 0) {
    return { ok: false, error: 'Give at least one phrase that should reach this agent.' };
  }

  const existing = await readCollection(scope, 'customAgents');
  if (existing.some((agent) => agent.id === id)) {
    return { ok: false, error: `“${name}” is already on this roster.` };
  }

  const kind = scope.kind === 'company' ? 'company' : 'personal';
  const at = new Date().toISOString();
  const record: CustomAgent = {
    id,
    scope,
    createdAt: at,
    updatedAt: at,
    name,
    domain: domain as SpecialistDomain,
    role: form.role.trim().slice(0, 120),
    charter: form.charter.trim().slice(0, 600),
    capabilityIds: chosen,
    matches,
    toolIds: [],
    allowedScopeKinds: [kind],
    wouldDo: [],
    overridesBuiltIn: getSpecialist(id) !== undefined,
    enabled: true,
    createdBy: 'founder',
  };
  await insertRecords(scope, 'customAgents', [record]);
  revalidatePath('/', 'layout');
  return { ok: true, agentId: id };
}

export async function setAgentEnabled(
  scopeKeyInput: string,
  agentId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  if (!scope) return { ok: false, error: 'No such space.' };

  const existing = await readCollection(scope, 'customAgents');
  const stored = existing.find((agent) => agent.id === agentId);

  if (stored) {
    // Only the explicit off-switch marker permits deletion: it is the one
    // record that carries nothing the founder authored. Everything else —
    // including a customised override that happens to share a built-in's id —
    // keeps its record and just flips the flag.
    if (enabled && stored.offSwitch) {
      await removeRecord(scope, 'customAgents', agentId);
    } else {
      await updateRecord(scope, 'customAgents', agentId, { enabled });
    }
    revalidatePath('/', 'layout');
    return { ok: true };
  }

  const builtIn = getSpecialist(agentId);
  if (!builtIn) return { ok: false, error: 'That agent is not on this roster.' };
  if (enabled) return { ok: true };

  // Switching a built-in off is a record, not a mutation of code: a disabled
  // override that hides it, reversible by enabling again.
  const at = new Date().toISOString();
  const record: CustomAgent = {
    id: builtIn.id,
    scope,
    createdAt: at,
    updatedAt: at,
    name: builtIn.name,
    domain: builtIn.domain,
    role: builtIn.role,
    charter: builtIn.charter,
    capabilityIds: builtIn.capabilityIds,
    matches: builtIn.matches,
    toolIds: [],
    allowedScopeKinds: builtIn.allowedScopeKinds,
    wouldDo: builtIn.wouldDo,
    overridesBuiltIn: true,
    offSwitch: true,
    enabled: false,
    createdBy: 'founder',
  };
  await insertRecords(scope, 'customAgents', [record]);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * A direct conversation turn with one roster member. The reply is grounded in
 * this scope's records the same way a meeting turn is; the exchange persists in
 * the scope's messages under the agent's channel, outside the assistant thread.
 */
export async function speakToAgent(
  scopeKeyInput: string,
  agentId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  const trimmed = text.trim();
  if (!scope) return { ok: false, error: 'No such space.' };
  if (!trimmed) return { ok: false, error: 'Say something first.' };

  const roster = await rosterFor(scope);
  const specialist = roster.find((candidate) => candidate.id === agentId);
  if (!specialist) return { ok: false, error: 'That agent is not on this roster.' };

  const channel = agentChannel(agentId);
  const messages = await readCollection(scope, 'messages');
  const history = messages
    .filter((message) => message.channel === channel)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const now = new Date();
  const at = now.toISOString();
  const founderMessage: AssistantMessage = {
    id: makeRecordId('msg', `${channel}:user:${at}:${trimmed}`),
    scope,
    createdAt: at,
    updatedAt: at,
    role: 'founder',
    text: trimmed.slice(0, 4000),
    at,
    simulated: false,
    providerId: 'founder',
    channel,
  };

  // The agent can find things out and do things, through exactly the loop the
  // assistant uses: reads run, writes run, anything gated queues for the
  // founder and halts the loop. Hiring changed who speaks, never what may run.
  const provider = await activeProvider();
  // The agent acts as itself, not as the founder's assistant: its own charter
  // decides what it may reach. Subtractive only — it can never exceed the space.
  const loop = await runActLoop(trimmed, { scope, provider, now, agent: specialist });
  const actLines = describeLoop(loop);
  const activity = loop.steps.map((step) => `- ${step.toolId}: ${step.summary}`).join('\n');

  const reply = await directAgentReply(scope, specialist, history, trimmed, {
    provider,
    ...(activity ? { activity } : {}),
  });
  const replyAt = new Date().toISOString();
  const agentMessage: AssistantMessage = {
    id: makeRecordId('msg', `${channel}:agent:${replyAt}:${reply.text.slice(0, 60)}`),
    scope,
    createdAt: replyAt,
    updatedAt: replyAt,
    role: 'assistant',
    text: actLines.length > 0 ? `${actLines.join('\n')}\n\n${reply.text}` : reply.text,
    at: replyAt,
    simulated: reply.simulated,
    providerId: reply.providerId,
    channel,
  };

  await insertRecords(scope, 'messages', [founderMessage, agentMessage]);
  revalidatePath('/', 'layout');
  return { ok: true };
}
