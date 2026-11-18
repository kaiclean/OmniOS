import 'server-only';

/**
 * Founder-level verbs: create a company, hire an agent, open a meeting.
 *
 * These do what a Server Action does without importing one — `lib/ai/` may not
 * import `lib/actions/` (see `tests/boundaries.test.ts`) — so they call the same
 * generators and the same store.
 */

import {
  COMPANY_STAGES,
  agentIdFrom,
  companyScope,
  type CustomAgent,
  type ToolExecutor,
} from '@/lib/domain';
import {
  getWorkspace,
  saveWorkspace,
  writeScopeData,
  insertRecords,
  readCollection,
} from '@/lib/data/store';
import { generateCompanyWorkspace } from '@/lib/generation/company-hq';
import { getPreset } from '@/lib/ai/agent-presets';
import { newMeeting, recommendParticipants } from '@/lib/ai/meeting';
import { rosterFor } from '@/lib/ai/roster';
import { argText } from '../index';
import { ok, refuse, spaceKindOf, base, optText, enumArg } from './shared';

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
export const createCompanyTool: ToolExecutor = async (ctx, args) => {
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

export const hireAgentTool: ToolExecutor = async (ctx, args) => {
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

export const openMeetingTool: ToolExecutor = async (ctx, args) => {
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
