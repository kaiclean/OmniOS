/**
 * The learning layer — how OmniOS changes because of what happened.
 *
 * The claim this file has to earn is "learns and evolves with every
 * interaction". That is only true if learning is *mechanical* rather than
 * aspirational, so everything here is a record the system actually writes and
 * actually reads back on the next turn:
 *
 * - An `Observation` is something noticed about the founder. It strengthens when
 *   it recurs and decays when it stops being true.
 * - A `RoutingHint` is created when the founder overrides which specialist
 *   handled something. The router reads hints before it scores, so a correction
 *   changes the next answer rather than being logged and forgotten.
 * - A `SpecialistScore` tracks whose recommendations get accepted, so the system
 *   can tell the founder which of its own specialists are earning their place.
 * - An `EvolutionEvent` is the audit trail: every time the system changed itself,
 *   what changed, and why. Without it, "it learns" is unfalsifiable.
 */

import type { ScopedRecord, Timestamp } from './work';

/* ------------------------------------------------------ observations ------ */

export const OBSERVATION_KINDS = [
  'preference',
  'pattern',
  'correction',
  'outcome',
  'style',
  'constraint',
] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export interface Observation extends ScopedRecord {
  readonly kind: ObservationKind;
  readonly text: string;
  readonly capabilityId: string;
  /** 0..1, raised by reinforcement and lowered by decay. */
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly source: 'interaction' | 'correction' | 'outcome' | 'founder';
  readonly reinforcements: number;
  readonly lastSeenAt: Timestamp;
  /** Set when the founder explicitly rejected it, so it is never re-learned. */
  readonly retiredAt?: Timestamp;
}

/**
 * Confidence decay.
 *
 * Something observed once three months ago should not steer today's plan with
 * the same force as something seen five times this week. Half-life is 60 days,
 * and reinforcement counts blunt it — a pattern confirmed repeatedly decays
 * slowly, a one-off fades.
 */
export function decayedConfidence(
  observation: Pick<Observation, 'confidence' | 'reinforcements' | 'lastSeenAt'>,
  now: Date = new Date(),
): number {
  const days = (now.getTime() - new Date(observation.lastSeenAt).getTime()) / 86_400_000;
  if (days <= 0) return observation.confidence;
  const halfLife = 60 * (1 + Math.min(observation.reinforcements, 10) * 0.35);
  const decayed = observation.confidence * Math.pow(0.5, days / halfLife);
  return Math.max(0, Math.min(1, Number(decayed.toFixed(4))));
}

/** Below this an observation stops being used, but is kept for the audit trail. */
export const OBSERVATION_FLOOR = 0.15;

export function isLive(observation: Observation, now: Date = new Date()): boolean {
  if (observation.retiredAt) return false;
  return decayedConfidence(observation, now) >= OBSERVATION_FLOOR;
}

/* --------------------------------------------------------- routing -------- */

export interface RoutingHint extends ScopedRecord {
  /** The lower-cased phrase the founder used when they corrected the routing. */
  readonly phrase: string;
  readonly specialistId: string;
  /** Grows each time the same correction is made. */
  readonly weight: number;
  readonly correctedFrom?: string;
  readonly lastAppliedAt?: Timestamp;
  readonly applications: number;
}

/* ------------------------------------------------------ performance ------- */

export interface SpecialistScore extends ScopedRecord {
  readonly specialistId: string;
  readonly invocations: number;
  readonly suggestionsMade: number;
  readonly suggestionsAccepted: number;
  readonly suggestionsDismissed: number;
  readonly routingCorrections: number;
  readonly lastUsedAt?: Timestamp;
}

/** Acceptance rate, or null when too few data points to mean anything. */
export function acceptanceRate(score: SpecialistScore): number | null {
  const decided = score.suggestionsAccepted + score.suggestionsDismissed;
  if (decided < 3) return null;
  return Number((score.suggestionsAccepted / decided).toFixed(3));
}

/* -------------------------------------------------------- evolution ------- */

export const EVOLUTION_KINDS = [
  'learned',
  'reinforced',
  'decayed',
  'retired',
  'routing-corrected',
  'promoted',
  'agent-added',
  'agent-changed',
  'tool-used',
  'tool-approved',
  'tool-rejected',
  'workspace-changed',
  'upgrade-decided',
] as const;
export type EvolutionKind = (typeof EVOLUTION_KINDS)[number];

/**
 * One entry in the system's account of how it changed.
 *
 * Deliberately append-only and never summarised away: the value of this log is
 * that a founder can scroll back a year and see precisely what the system
 * concluded about them and on what evidence.
 */
export interface EvolutionEvent extends ScopedRecord {
  readonly at: Timestamp;
  readonly kind: EvolutionKind;
  readonly summary: string;
  readonly detail?: string;
  readonly before?: string;
  readonly after?: string;
  readonly specialistId?: string;
  readonly capabilityId?: string;
  /** True when the system did this itself rather than being told to. */
  readonly autonomous: boolean;
}
