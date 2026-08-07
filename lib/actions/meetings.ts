'use server';

import { revalidatePath } from 'next/cache';

import type { Meeting, MeetingTurn, Scope } from '@/lib/domain';
import { parseScopeKey } from '@/lib/domain';
import { insertRecords, readCollection, updateRecord } from '@/lib/data/store';
import { draftPlan, newMeeting, recommendParticipants, specialistTurn } from '@/lib/ai/meeting';
import { proposeCore } from '@/lib/ai/tools/propose';

/**
 * The meeting room's mutations.
 *
 * The founder is in the loop at every stage by construction: specialists speak
 * only when spoken to (one addressee, or the whole room in turn), the plan is a
 * draft until the founder approves it, and approval converts tasks through the
 * same propose→gate path as everything else. There is no stage at which the
 * room can act without the founder having just acted.
 */

function resolveScope(scopeKeyInput: string): Scope | null {
  const scope = parseScopeKey(scopeKeyInput);
  if (!scope || scope.kind === 'shared') return null;
  return scope;
}

async function findMeeting(scope: Scope, meetingId: string): Promise<Meeting | undefined> {
  const meetings = await readCollection(scope, 'meetings');
  return meetings.find((meeting) => meeting.id === meetingId);
}

export async function openMeeting(
  scopeKeyInput: string,
  topic: string,
): Promise<{ ok: boolean; meetingId?: string; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  const trimmed = topic.trim();
  if (!scope) return { ok: false, error: 'Meetings happen inside a company or your life, never in shared memory.' };
  if (trimmed.length < 3) return { ok: false, error: 'Give the meeting a topic.' };

  const participants = recommendParticipants(
    trimmed,
    scope.kind === 'company' ? 'company' : 'personal',
  );
  const meeting = newMeeting(scope, trimmed.slice(0, 200), participants.map((s) => s.id), new Date());
  await insertRecords(scope, 'meetings', [meeting]);
  revalidatePath('/', 'layout');
  return { ok: true, meetingId: meeting.id };
}

/**
 * The founder speaks; the room answers.
 *
 * Addressed to one participant, exactly that specialist replies. Addressed to
 * nobody, every participant replies in roster order — "ask everyone". Each
 * reply is grounded in the meeting's own scope before any model touches it.
 */
export async function speakInMeeting(
  scopeKeyInput: string,
  meetingId: string,
  text: string,
  addresseeId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  const trimmed = text.trim();
  if (!scope || !trimmed) return { ok: false, error: 'Say something first.' };

  const meeting = await findMeeting(scope, meetingId);
  if (!meeting) return { ok: false, error: 'That meeting is not in this space.' };
  if (meeting.stage === 'closed') return { ok: false, error: 'That meeting is closed.' };

  const now = new Date();
  const founderTurn: MeetingTurn = {
    speakerId: 'founder',
    text: trimmed.slice(0, 2000),
    at: now.toISOString(),
    ...(addresseeId ? { addresseeId } : {}),
    simulated: false,
  };

  const speakers =
    addresseeId && meeting.participantIds.includes(addresseeId)
      ? [addresseeId]
      : meeting.participantIds;

  const replies: MeetingTurn[] = [];
  const withFounder: Meeting = { ...meeting, turns: [...meeting.turns, founderTurn] };
  for (const specialistId of speakers) {
    // Each specialist sees the turns spoken before them, including colleagues in
    // this same round — that is what lets the room actually discuss.
    const visible: Meeting = { ...withFounder, turns: [...withFounder.turns, ...replies] };
    replies.push(await specialistTurn(visible, scope, specialistId, trimmed, new Date()));
  }

  await updateRecord(scope, 'meetings', meetingId, {
    turns: [...meeting.turns, founderTurn, ...replies],
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function draftMeetingPlan(
  scopeKeyInput: string,
  meetingId: string,
): Promise<{ ok: boolean; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  if (!scope) return { ok: false, error: 'No such space.' };
  const meeting = await findMeeting(scope, meetingId);
  if (!meeting) return { ok: false, error: 'That meeting is not in this space.' };
  if (meeting.turns.length === 0) return { ok: false, error: 'Nothing has been discussed yet.' };

  const plan = await draftPlan(meeting, new Date());
  await updateRecord(scope, 'meetings', meetingId, { plan, stage: 'plan-ready' });
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * The human approval stage. Each planned task becomes a real record through the
 * gate; the meeting keeps the created ids so execution is observable from the
 * tasks themselves — one source of truth, no parallel progress state.
 */
export async function approveMeetingPlan(
  scopeKeyInput: string,
  meetingId: string,
): Promise<{ ok: boolean; created: number; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  if (!scope) return { ok: false, created: 0, error: 'No such space.' };
  const meeting = await findMeeting(scope, meetingId);
  if (!meeting?.plan) return { ok: false, created: 0, error: 'There is no plan to approve.' };
  if (meeting.stage !== 'plan-ready') {
    return { ok: false, created: 0, error: `The meeting is ${meeting.stage}, not awaiting approval.` };
  }

  const now = new Date();
  const tasksWithIds = [];
  let created = 0;
  for (const task of meeting.plan.tasks) {
    const outcome = await proposeCore(scope, 'create_task', {
      title: task.title,
      capabilityId: task.capabilityId,
      status: 'next',
      notes: `From the meeting “${meeting.topic}” — owner: ${task.ownerSpecialistId}.`,
    }, { now });
    if (outcome.ok) created += 1;
    tasksWithIds.push({ ...task, ...(outcome.affectedIds?.[0] ? { taskId: outcome.affectedIds[0] } : {}) });
  }

  await updateRecord(scope, 'meetings', meetingId, {
    stage: 'executing',
    approvedAt: now.toISOString(),
    plan: { ...meeting.plan, tasks: tasksWithIds },
  });
  revalidatePath('/', 'layout');
  return { ok: true, created };
}

export async function closeMeeting(scopeKeyInput: string, meetingId: string): Promise<void> {
  const scope = resolveScope(scopeKeyInput);
  if (!scope) return;
  await updateRecord(scope, 'meetings', meetingId, {
    stage: 'closed',
    closedAt: new Date().toISOString(),
  });
  revalidatePath('/', 'layout');
}
