'use server';

import { revalidatePath } from 'next/cache';

import type { Meeting, MeetingTurn, Scope } from '@/lib/domain';
import { credentialShape, parseScopeKey } from '@/lib/domain';
import { insertRecords, mutateScope, readCollection, updateRecord } from '@/lib/data/store';
import { draftPlan, newMeeting, recommendParticipants, specialistTurn, turnContext } from '@/lib/ai/meeting';
import { rosterFor } from '@/lib/ai/roster';
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
    await rosterFor(scope),
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

  // A meeting turn persists to disk and is read by every participant's model —
  // a pasted token would leak twice over. Refuse it the same way the composer
  // does, before it is stored or sent.
  const credential = credentialShape(trimmed);
  if (credential) {
    return {
      ok: false,
      error: `That looks like it contains a ${credential}, so I have not stored or sent it. Put it in the vault — Connections → Keys and secrets — and refer to it by name, then rotate it if it was real.`,
    };
  }

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

  // One roster/records/provider resolution for the whole round, not one per
  // seat — five specialists answering must not mean five vault probes.
  const round = await turnContext(scope);

  const replies: MeetingTurn[] = [];
  const withFounder: Meeting = { ...meeting, turns: [...meeting.turns, founderTurn] };
  for (const specialistId of speakers) {
    // Each specialist sees the turns spoken before them, including colleagues in
    // this same round — that is what lets the room actually discuss.
    const visible: Meeting = { ...withFounder, turns: [...withFounder.turns, ...replies] };
    replies.push(await specialistTurn(visible, scope, specialistId, trimmed, new Date(), round));
  }

  // Appended against the record as it is *now*, not as it was before the model
  // calls: a round takes seconds, and a snapshot write would erase any turn
  // that landed from another tab in between.
  await mutateScope(scope, (data) => ({
    ...data,
    meetings: data.meetings.map((record) =>
      record.id === meetingId
        ? { ...record, turns: [...record.turns, founderTurn, ...replies], updatedAt: new Date().toISOString() }
        : record,
    ),
  }));
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
  // An approved plan carries the ids of the tasks it created; re-drafting would
  // sever those links and re-approving would create every task twice. A closed
  // meeting is closed. Only a live discussion (or an unapproved draft the
  // founder sent back) may be drafted.
  if (meeting.stage === 'executing' || meeting.stage === 'closed') {
    return { ok: false, error: `The meeting is ${meeting.stage} — its plan is part of the record now.` };
  }

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
): Promise<{ ok: boolean; created: number; queued: number; error?: string }> {
  const scope = resolveScope(scopeKeyInput);
  if (!scope) return { ok: false, created: 0, queued: 0, error: 'No such space.' };
  const meeting = await findMeeting(scope, meetingId);
  if (!meeting?.plan) return { ok: false, created: 0, queued: 0, error: 'There is no plan to approve.' };
  if (meeting.stage !== 'plan-ready') {
    return { ok: false, created: 0, queued: 0, error: `The meeting is ${meeting.stage}, not awaiting approval.` };
  }

  const now = new Date();
  const tasksWithIds = [];
  // "Created" means a record exists. A call the gate held (confirm-writes mode
  // queues even task creation) is queued, not created — reporting it as done
  // would be the system lying about its own state.
  let created = 0;
  let queued = 0;
  for (const task of meeting.plan.tasks) {
    const outcome = await proposeCore(scope, 'create_task', {
      title: task.title,
      capabilityId: task.capabilityId,
      status: 'next',
      notes: `From the meeting “${meeting.topic}” — owner: ${task.ownerSpecialistId}.`,
    }, { now });
    if (outcome.awaitingApproval) queued += 1;
    else if (outcome.ok) created += 1;
    tasksWithIds.push({ ...task, ...(outcome.affectedIds?.[0] ? { taskId: outcome.affectedIds[0] } : {}) });
  }

  await updateRecord(scope, 'meetings', meetingId, {
    stage: 'executing',
    approvedAt: now.toISOString(),
    plan: { ...meeting.plan, tasks: tasksWithIds },
  });
  revalidatePath('/', 'layout');
  return {
    ok: true,
    created,
    queued,
    ...(queued > 0
      ? { error: `${queued} of the plan's tasks stopped at the gate — decide them under Approvals.` }
      : {}),
  };
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
