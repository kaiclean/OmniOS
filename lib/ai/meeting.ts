import 'server-only';

/**
 * The meeting engine — specialists that speak, grounded in the room's records.
 *
 * Each turn works the way every answer in OmniOS works: the analysis comes from
 * the store first, then a model phrases it in the specialist's voice when a key
 * exists. A specialist's briefing is drawn only from the meeting's own scope,
 * filtered to the capabilities that specialist owns — the Finance voice reads
 * the ledger, not the founder's health log. No participant can widen its reach:
 * the scope was fixed when the meeting was opened.
 *
 * Without a model the turns are composed locally from the same briefing, marked
 * simulated, and plainly template-shaped. That is the honest floor, not the
 * product: the room becomes a real discussion the moment a key is in the vault.
 */

import type { Meeting, MeetingPlan, MeetingTask, MeetingTurn, Scope } from '@/lib/domain';
import { makeRecordId } from '@/lib/domain';
import type { ScopeData } from '@/lib/data/schema';
import { readScope } from '@/lib/data/store';
import { capabilityIds } from '@/lib/capabilities/registry';
import type { SpecialistAgent } from '@/lib/domain';
import { SPECIALISTS, getSpecialist } from './specialists';
import { rosterFor, rosterNames } from './roster';
import { activeProvider } from './providers';

/**
 * Who belongs in the room for this topic.
 *
 * Scored with the same keyword machinery the router uses, then topped up with
 * the chief-of-staff so there is always a voice for sequencing. Capped at five:
 * past that a meeting stops being a discussion and becomes a broadcast.
 */
export function recommendParticipants(
  topic: string,
  spaceKind: 'company' | 'personal',
  roster: readonly SpecialistAgent[] = SPECIALISTS,
): SpecialistAgent[] {
  const text = topic.toLowerCase();
  const scored = roster.filter((s) => s.allowedScopeKinds.includes(spaceKind))
    .map((specialist) => ({
      specialist,
      score: specialist.matches.reduce((sum, phrase) => (text.includes(phrase) ? sum + 2 : sum), 0),
    }))
    .sort((a, b) => b.score - a.score);

  const picked = scored.filter((entry) => entry.score > 0).slice(0, 4).map((entry) => entry.specialist);
  const chief = roster.find((s) => s.id === 'chief-of-staff') ?? scored[0]?.specialist;
  if (chief && !picked.some((s) => s.id === chief.id)) picked.unshift(chief);
  return picked.slice(0, 5);
}

/** The slice of the room's records one specialist is entitled to speak from. */
export function briefingFor(specialist: SpecialistAgent, data: ScopeData): string {
  const owned = new Set(specialist.capabilityIds.length ? specialist.capabilityIds : capabilityIds());
  const lines: string[] = [];

  const tasks = data.tasks.filter((t) => t.status !== 'done' && owned.has(t.capabilityId)).slice(0, 6);
  if (tasks.length) lines.push(`Open work: ${tasks.map((t) => `${t.title} (${t.status})`).join('; ')}`);

  const kpis = data.kpis.filter((k) => owned.has(k.capabilityId)).slice(0, 5);
  if (kpis.length) lines.push(`Numbers: ${kpis.map((k) => `${k.label} = ${k.value}`).join('; ')}`);

  const risks = data.risks.filter((r) => owned.has(r.capabilityId)).slice(0, 3);
  if (risks.length) lines.push(`Risks on record: ${risks.map((r) => r.label).join('; ')}`);

  const goals = data.goals.filter((g) => owned.has(g.capabilityId) && g.status !== 'achieved').slice(0, 3);
  if (goals.length) lines.push(`Goals: ${goals.map((g) => g.title).join('; ')}`);

  return lines.length ? lines.join('\n') : 'No records in this specialist’s capabilities yet.';
}

function transcript(meeting: Meeting, limit = 14, names: Readonly<Record<string, string>> = {}): string {
  return meeting.turns
    .slice(-limit)
    .map(
      (turn) =>
        `${turn.speakerId === 'founder' ? 'Founder' : (names[turn.speakerId] ?? getSpecialist(turn.speakerId)?.name ?? turn.speakerId)}: ${turn.text}`,
    )
    .join('\n');
}

/** One specialist speaks. Grounded first; model-voiced when possible. */
export interface TurnContext {
  readonly roster: readonly SpecialistAgent[];
  readonly data: ScopeData;
  readonly provider: Awaited<ReturnType<typeof activeProvider>>;
}

/** Resolved once per founder message; an "ask everyone" round reuses it five times. */
export async function turnContext(scope: Scope): Promise<TurnContext> {
  return {
    roster: await rosterFor(scope),
    data: await readScope(scope),
    provider: await activeProvider(),
  };
}

export async function specialistTurn(
  meeting: Meeting,
  scope: Scope,
  specialistId: string,
  founderPrompt: string,
  now: Date,
  preloaded?: TurnContext,
): Promise<MeetingTurn> {
  // The room's roster is the scope's roster: an agent the founder hired here
  // can be seated and speak; one hired elsewhere does not exist in this room.
  const { roster, data, provider } = preloaded ?? (await turnContext(scope));
  const specialist = roster.find((s) => s.id === specialistId);
  const at = now.toISOString();
  if (!specialist) {
    return { speakerId: specialistId, text: 'That specialist is not on the roster.', at, simulated: true };
  }

  const names = rosterNames(roster);
  const briefing = briefingFor(specialist, data);

  if (!provider.simulated) {
    try {
      const response = await provider.complete({
        messages: [
          {
            role: 'system',
            content: `You are ${specialist.name} — ${specialist.role} — in a working meeting inside the founder's operating system. Your charter: ${specialist.charter}

Speak in first person, 2-5 sentences, as a colleague in the room. Ground every claim in the briefing below; if the briefing does not support a claim, say what is unknown rather than inventing it. Disagree with other participants when the records justify it.

Briefing, computed from this space's real records (only your capabilities):
${briefing}`,
          },
          {
            role: 'user',
            content: `Meeting topic: ${meeting.topic}

Recent discussion:
${transcript(meeting, 14, names)}

The founder just said: "${founderPrompt}". Respond as ${specialist.name}.`,
          },
        ],
        maxTokens: 2048,
      });
      if (response.text.trim()) {
        return { speakerId: specialistId, text: response.text.trim(), at, simulated: false };
      }
    } catch {
      // Fall through to the local voice — a provider failure never empties a turn.
    }
  }

  const stance = specialist.wouldDo[0] ?? specialist.charter;
  return {
    speakerId: specialistId,
    text: `From the records I can see: ${briefing.split('\n')[0] ?? 'nothing filed under my capabilities yet'}. My position, per my charter: ${stance}.`,
    at,
    simulated: true,
  };
}

/**
 * Turn the discussion into outcomes.
 *
 * With a model: structured extraction from the transcript, parsed defensively —
 * anything malformed degrades to fewer outcomes, never to invented ones. Every
 * task must name a real capability and a participant; anything else is dropped.
 * Locally: an honest empty plan that says a model would do better.
 */
export async function draftPlan(meeting: Meeting, now: Date): Promise<MeetingPlan> {
  const provider = await activeProvider();
  const validCapabilities = new Set(capabilityIds());
  const participants = new Set(meeting.participantIds);

  if (!provider.simulated) {
    try {
      const response = await provider.complete({
        messages: [
          {
            role: 'system',
            content: `You turn a meeting transcript into a plan. Reply with ONLY a JSON object: {"summary": string, "decisions": string[], "risks": string[], "tasks": [{"title": string, "capabilityId": string, "ownerSpecialistId": string}]}. Use only what was actually said — no invented tasks. capabilityId must be one of: ${[...validCapabilities].join(', ')}. ownerSpecialistId must be one of: ${meeting.participantIds.join(', ')}. At most 8 tasks.`,
          },
          { role: 'user', content: `Topic: ${meeting.topic}\n\nTranscript:\n${transcript(meeting, 40)}` },
        ],
        maxTokens: 2048,
      });
      const raw = response.text.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(raw) as {
        summary?: string;
        decisions?: unknown[];
        risks?: unknown[];
        tasks?: Array<{ title?: string; capabilityId?: string; ownerSpecialistId?: string }>;
      };
      const tasks: MeetingTask[] = (parsed.tasks ?? [])
        .filter(
          (t): t is { title: string; capabilityId: string; ownerSpecialistId: string } =>
            typeof t.title === 'string' &&
            t.title.length > 2 &&
            typeof t.capabilityId === 'string' &&
            validCapabilities.has(t.capabilityId) &&
            typeof t.ownerSpecialistId === 'string' &&
            participants.has(t.ownerSpecialistId),
        )
        .slice(0, 8);
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : meeting.topic,
        decisions: (parsed.decisions ?? []).filter((d): d is string => typeof d === 'string').slice(0, 8),
        risks: (parsed.risks ?? []).filter((r): r is string => typeof r === 'string').slice(0, 5),
        tasks,
        simulated: false,
      };
    } catch {
      // Fall through: a malformed model reply degrades to the local plan.
    }
  }

  return {
    summary: `Discussion on “${meeting.topic}” with ${meeting.participantIds.length} specialists — ${meeting.turns.length} turns.`,
    decisions: [],
    risks: [],
    tasks: [],
    simulated: true,
  };
}

export function newMeeting(scope: Scope, topic: string, participantIds: readonly string[], now: Date): Meeting {
  const at = now.toISOString();
  return {
    id: makeRecordId('meet', `${topic}:${at}`),
    scope,
    createdAt: at,
    updatedAt: at,
    topic,
    stage: 'in-session',
    participantIds,
    turns: [],
  };
}
