/**
 * Meetings — the founder in the room with the specialists.
 *
 * A meeting is not several chatbots side by side. It is a structured process
 * with the founder inside it: participants are chosen for the topic, every turn
 * is recorded with its speaker, and the meeting is not over until it has
 * produced outcomes — a plan the founder can approve, edit or reject. Approval
 * converts the plan into ordinary records through the same propose→gate path as
 * everything else, which is why a meeting can genuinely end in execution rather
 * than in a transcript.
 *
 * Meetings are scoped records: a company's meeting lives in that company's
 * file, reads that company's context, and no other's — the same isolation as
 * every other record.
 */

import type { ScopedRecord, Timestamp } from './work';

export const MEETING_STAGES = ['in-session', 'plan-ready', 'executing', 'closed'] as const;
export type MeetingStage = (typeof MEETING_STAGES)[number];

export interface MeetingTurn {
  /** 'founder' or a specialist id. Every word in the room has an author. */
  readonly speakerId: string;
  readonly text: string;
  readonly at: Timestamp;
  /** Set when the founder addressed one participant rather than the room. */
  readonly addresseeId?: string;
  /** True when the words were composed locally rather than by a model. */
  readonly simulated: boolean;
}

export interface MeetingTask {
  readonly title: string;
  readonly capabilityId: string;
  readonly ownerSpecialistId: string;
  /** Set once the plan is approved and the task record actually exists. */
  readonly taskId?: string;
}

export interface MeetingPlan {
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly tasks: readonly MeetingTask[];
  readonly risks: readonly string[];
  readonly simulated: boolean;
}

export interface Meeting extends ScopedRecord {
  readonly topic: string;
  readonly stage: MeetingStage;
  /** Specialist ids in the room. The founder is always present and never listed. */
  readonly participantIds: readonly string[];
  readonly turns: readonly MeetingTurn[];
  readonly plan?: MeetingPlan;
  readonly approvedAt?: Timestamp;
  readonly closedAt?: Timestamp;
}
