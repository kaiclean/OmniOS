/**
 * Reinforcement and decay — the part that makes learning honest.
 *
 * Noticing something is cheap. The expensive, and the only interesting, question
 * is how long a system should keep believing it. OmniOS answers that with two
 * mechanics that pull against each other:
 *
 * - **Decay** happens on read, not on a schedule. `decayedConfidence` is applied
 *   every time a belief is used, so an observation nobody has confirmed for four
 *   months quietly stops steering answers without any sweep job having run.
 * - **Reinforcement** happens on recurrence. A repeat raises confidence *and*
 *   lengthens the half-life, so the difference between a fluke and a habit shows
 *   up as a measurable difference in how fast the belief fades.
 *
 * Everything here is pure and takes `now` explicitly. That is what lets a test
 * assert that a pattern seen five times survives a quarter that a one-off does not.
 */

import type { MemoryRecord, Observation, Scope, SpecialistScore, Timestamp } from '@/lib/domain';
import { decayedConfidence, isLive, makeRecordId, scopeKey } from '@/lib/domain';

/* ------------------------------------------------------- the curve -------- */

/**
 * How far one confirmation closes the remaining gap to certainty.
 *
 * Proportional rather than additive, so nothing ever reaches 1.0 and the system
 * never claims to be certain about a person on the strength of counting.
 */
const REINFORCEMENT_STEP = 0.34;

/** A founder saying "yes, that is true of me" is worth more than another sighting. */
const CONFIRMATION_STEP = 0.6;

export function raise(value: number, step: number = REINFORCEMENT_STEP): number {
  const bounded = Math.max(0, Math.min(1, value));
  return Number(Math.min(1, bounded + (1 - bounded) * step).toFixed(4));
}

/* ------------------------------------------------- observation merging ---- */

export interface Reinforcement {
  readonly before: Observation;
  readonly after: Observation;
}

export interface MergeOutcome {
  /** The full next list for the scope, newest first, ready to write. */
  readonly observations: readonly Observation[];
  readonly learned: readonly Observation[];
  readonly reinforced: readonly Reinforcement[];
  /** Candidates that matched a retired belief and were therefore dropped. */
  readonly ignored: readonly Observation[];
}

const MAX_EVIDENCE = 6;

/**
 * Fold this interaction's candidates into what the scope already believes.
 *
 * The retired case is the important one: a belief the founder explicitly rejected
 * must never come back, however often the pattern that produced it recurs.
 * Without that rule "I told it no" would be a suggestion rather than a decision.
 */
export function mergeObservations(
  existing: readonly Observation[],
  candidates: readonly Observation[],
  now: Date,
): MergeOutcome {
  const byId = new Map(existing.map((observation) => [observation.id, observation]));
  const replacements = new Map<string, Observation>();
  const learned: Observation[] = [];
  const reinforced: Reinforcement[] = [];
  const ignored: Observation[] = [];

  for (const candidate of candidates) {
    const before = replacements.get(candidate.id) ?? byId.get(candidate.id);

    if (!before) {
      learned.push(candidate);
      byId.set(candidate.id, candidate);
      continue;
    }

    if (before.retiredAt) {
      ignored.push(candidate);
      continue;
    }

    // Raising from the *decayed* value, not the stored one, is deliberate: a
    // belief that has been dormant for a year should not snap back to full
    // strength on one sighting, it should climb again from where it actually is.
    const after: Observation = {
      ...before,
      confidence: raise(decayedConfidence(before, now)),
      reinforcements: before.reinforcements + 1,
      lastSeenAt: candidate.lastSeenAt,
      updatedAt: candidate.updatedAt,
      evidence: [...new Set([...candidate.evidence, ...before.evidence])].slice(0, MAX_EVIDENCE),
    };
    replacements.set(after.id, after);
    reinforced.push({ before, after });
  }

  const observations = [
    ...learned,
    ...existing.map((observation) => replacements.get(observation.id) ?? observation),
  ];

  return { observations, learned, reinforced, ignored };
}

/* ------------------------------------------------------------- reads ------ */

export function strengthOf(observation: Observation, now: Date): number {
  return decayedConfidence(observation, now);
}

/**
 * The beliefs strong enough to act on, strongest first.
 *
 * This is the only function anything assembling context should call. Reading
 * `observations` raw would use beliefs that have faded below the floor and beliefs
 * the founder retired.
 */
export function liveObservations(
  observations: readonly Observation[],
  now: Date,
  limit?: number,
): Observation[] {
  const live = observations
    .filter((observation) => isLive(observation, now))
    .sort(
      (a, b) =>
        strengthOf(b, now) - strengthOf(a, now) || a.id.localeCompare(b.id),
    );
  return limit === undefined ? live : live.slice(0, Math.max(0, limit));
}

/**
 * Beliefs that have fallen below the floor without being retired.
 *
 * Kept separate from retirement: these are things the system stopped believing on
 * its own, and the founder is entitled to see that happen in the evolution log.
 */
export function fadedObservations(observations: readonly Observation[], now: Date): Observation[] {
  return observations.filter((observation) => !observation.retiredAt && !isLive(observation, now));
}

/* -------------------------------------------------- founder decisions ----- */

export function retired(observation: Observation, at: Timestamp): Observation {
  return { ...observation, retiredAt: at, updatedAt: at };
}

/**
 * The founder confirming a belief out loud.
 *
 * Source flips to `founder` because the provenance genuinely changed: this is no
 * longer something the system inferred, it is something it was told.
 */
export function confirmed(observation: Observation, at: Timestamp): Observation {
  const { retiredAt: _retiredAt, ...rest } = observation;
  return {
    ...rest,
    confidence: raise(observation.confidence, CONFIRMATION_STEP),
    reinforcements: observation.reinforcements + 1,
    lastSeenAt: at,
    updatedAt: at,
    source: 'founder',
  };
}

/* ------------------------------------------------------------ memory ------ */

/**
 * Memory strength under the same law as observation confidence.
 *
 * `MemoryRecord.strength` is documented as decaying unless reinforced, and until
 * now nothing computed that. Reusing `decayedConfidence` — with use count standing
 * in for reinforcements — means the two learning surfaces cannot drift apart.
 */
export function memoryStrength(record: MemoryRecord, now: Date): number {
  return decayedConfidence(
    {
      confidence: record.strength,
      reinforcements: record.useCount,
      lastSeenAt: record.lastUsedAt ?? record.updatedAt,
    },
    now,
  );
}

export function reinforceMemory(record: MemoryRecord, now: Date, at: Timestamp): MemoryRecord {
  return {
    ...record,
    strength: raise(memoryStrength(record, now)),
    useCount: record.useCount + 1,
    lastUsedAt: at,
    updatedAt: at,
  };
}

export interface MemoryReinforcement {
  readonly memory: readonly MemoryRecord[];
  readonly reinforced: readonly MemoryRecord[];
}

/** Strengthens exactly the records that were used to answer, and nothing else. */
export function reinforceMemories(
  memory: readonly MemoryRecord[],
  usedIds: readonly string[],
  now: Date,
  at: Timestamp,
): MemoryReinforcement {
  const used = new Set(usedIds);
  if (used.size === 0) return { memory, reinforced: [] };

  const reinforced: MemoryRecord[] = [];
  const next = memory.map((record) => {
    if (!used.has(record.id)) return record;
    const updated = reinforceMemory(record, now, at);
    reinforced.push(updated);
    return updated;
  });

  return { memory: next, reinforced };
}

/* -------------------------------------------------- specialist scores ----- */

export const SPECIALIST_EVENTS = [
  'invoked',
  'suggested',
  'accepted',
  'dismissed',
  'routing-corrected',
] as const;
export type SpecialistEvent = (typeof SPECIALIST_EVENTS)[number];

export function specialistScoreId(scope: Scope, specialistId: string): string {
  return makeRecordId('spec', `${scopeKey(scope)}:${specialistId}`);
}

function emptyScore(scope: Scope, specialistId: string, at: Timestamp): SpecialistScore {
  return {
    id: specialistScoreId(scope, specialistId),
    scope,
    createdAt: at,
    updatedAt: at,
    specialistId,
    invocations: 0,
    suggestionsMade: 0,
    suggestionsAccepted: 0,
    suggestionsDismissed: 0,
    routingCorrections: 0,
  };
}

function applied(score: SpecialistScore, event: SpecialistEvent, at: Timestamp): SpecialistScore {
  switch (event) {
    case 'invoked':
      return { ...score, invocations: score.invocations + 1, lastUsedAt: at, updatedAt: at };
    case 'suggested':
      return { ...score, suggestionsMade: score.suggestionsMade + 1, updatedAt: at };
    case 'accepted':
      return { ...score, suggestionsAccepted: score.suggestionsAccepted + 1, updatedAt: at };
    case 'dismissed':
      return { ...score, suggestionsDismissed: score.suggestionsDismissed + 1, updatedAt: at };
    case 'routing-corrected':
      return { ...score, routingCorrections: score.routingCorrections + 1, updatedAt: at };
  }
}

export interface ScoreInput {
  readonly scope: Scope;
  readonly specialistId: string;
  readonly event: SpecialistEvent;
  readonly at: Timestamp;
}

export interface ScoreOutcome {
  readonly scores: readonly SpecialistScore[];
  readonly score: SpecialistScore;
  readonly created: boolean;
}

/**
 * Track how a specialist is actually doing.
 *
 * The counters are raw on purpose. `acceptanceRate` refuses to divide under three
 * decisions, and that refusal is the point: a specialist with one accepted
 * suggestion is not "100% accurate", it is unmeasured, and the UI has to be able
 * to say so with an em dash rather than a flattering number.
 */
export function recordSpecialistEvent(
  scores: readonly SpecialistScore[],
  input: ScoreInput,
): ScoreOutcome {
  const id = specialistScoreId(input.scope, input.specialistId);
  const existing = scores.find((score) => score.id === id);
  const base = existing ?? emptyScore(input.scope, input.specialistId, input.at);
  const score = applied(base, input.event, input.at);

  return {
    scores: existing ? scores.map((entry) => (entry.id === id ? score : entry)) : [score, ...scores],
    score,
    created: !existing,
  };
}

/** Applies several events in order — one invocation touches every consulted specialist. */
export function recordSpecialistEvents(
  scores: readonly SpecialistScore[],
  inputs: readonly ScoreInput[],
): readonly SpecialistScore[] {
  return inputs.reduce<readonly SpecialistScore[]>(
    (current, input) => recordSpecialistEvent(current, input).scores,
    scores,
  );
}
