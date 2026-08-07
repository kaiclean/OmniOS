/**
 * The evolution log — the evidence for the whole claim.
 *
 * "It learns and evolves with every interaction" is unfalsifiable unless the
 * system can show its working. This is the working: every time OmniOS changed
 * what it believes, how it routes, what it remembers or what it is allowed to do,
 * one line lands here saying what changed, from what to what, and whether a human
 * asked for it.
 *
 * Two properties are non-negotiable and shape the whole module:
 *
 * - **Append-only.** There is no update and no delete, in this file or anywhere
 *   else. A log that can be rewritten proves nothing. `appendEvolution` is the
 *   only writer and it cannot drop an existing entry.
 * - **`autonomous` is never guessed.** It says whether the system did this by
 *   itself. Marking a human decision autonomous — or the reverse — would make the
 *   log actively misleading, which is worse than not keeping one.
 */

import type { EvolutionEvent, EvolutionKind, Observation, RoutingHint, Scope, Timestamp } from '@/lib/domain';
import { makeRecordId, scopeKey } from '@/lib/domain';

export interface EvolutionInput {
  readonly scope: Scope;
  readonly at: Timestamp;
  readonly kind: EvolutionKind;
  readonly summary: string;
  readonly detail?: string;
  readonly before?: string;
  readonly after?: string;
  readonly specialistId?: string;
  readonly capabilityId?: string;
  readonly autonomous: boolean;
  /**
   * Seeds the id instead of the timestamp.
   *
   * Supply one where the same conclusion must not be logged twice: a decay sweep
   * runs on every interaction, and without a stable key it would write "this
   * belief faded" forever instead of once.
   */
  readonly key?: string;
}

export function evolutionEvent(input: EvolutionInput): EvolutionEvent {
  const seed = `${scopeKey(input.scope)}:${input.kind}:${input.key ?? `${input.at}:${input.summary}`}`;
  return {
    id: makeRecordId('evo', seed),
    scope: input.scope,
    createdAt: input.at,
    updatedAt: input.at,
    at: input.at,
    kind: input.kind,
    summary: input.summary,
    autonomous: input.autonomous,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.before ? { before: input.before } : {}),
    ...(input.after ? { after: input.after } : {}),
    ...(input.specialistId ? { specialistId: input.specialistId } : {}),
    ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
  };
}

/**
 * The only way anything enters the log.
 *
 * Existing entries are returned untouched, by reference, so a caller cannot
 * quietly rewrite history by round-tripping through here. Events whose id is
 * already present are skipped rather than duplicated — replaying an interaction
 * should not double-log the conclusions it drew.
 */
export function appendEvolution(
  log: readonly EvolutionEvent[],
  events: readonly EvolutionEvent[],
): EvolutionEvent[] {
  const seen = new Set(log.map((event) => event.id));
  const fresh: EvolutionEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
  }
  return [...fresh, ...log];
}

/* ------------------------------------------------- learning-side events --- */

const excerpt = (text: string, max = 120): string => text.trim().replace(/\s+/g, ' ').slice(0, max);

export function learnedEvent(observation: Observation, at: Timestamp): EvolutionEvent {
  return evolutionEvent({
    scope: observation.scope,
    at,
    kind: 'learned',
    summary: `Learned: ${excerpt(observation.text)}`,
    detail: observation.evidence[0],
    after: observation.confidence.toFixed(2),
    capabilityId: observation.capabilityId,
    autonomous: observation.source !== 'founder',
    key: `learned:${observation.id}`,
  });
}

export function reinforcedEvent(
  before: Observation,
  after: Observation,
  at: Timestamp,
): EvolutionEvent {
  return evolutionEvent({
    scope: after.scope,
    at,
    kind: 'reinforced',
    summary: `Seen again (${after.reinforcements}×): ${excerpt(after.text)}`,
    before: before.confidence.toFixed(2),
    after: after.confidence.toFixed(2),
    capabilityId: after.capabilityId,
    autonomous: true,
    key: `reinforced:${after.id}:${after.reinforcements}`,
  });
}

/** Written once, when a belief first falls below the floor on its own. */
export function decayedEvent(
  observation: Observation,
  strength: number,
  at: Timestamp,
): EvolutionEvent {
  return evolutionEvent({
    scope: observation.scope,
    at,
    kind: 'decayed',
    summary: `Stopped relying on: ${excerpt(observation.text)}`,
    detail: 'Not seen again for long enough that it no longer steers answers. Kept for the record.',
    before: observation.confidence.toFixed(2),
    after: strength.toFixed(2),
    capabilityId: observation.capabilityId,
    autonomous: true,
    key: `decayed:${observation.id}`,
  });
}

export function retiredEvent(observation: Observation, at: Timestamp): EvolutionEvent {
  return evolutionEvent({
    scope: observation.scope,
    at,
    kind: 'retired',
    summary: `Retired on your instruction: ${excerpt(observation.text)}`,
    capabilityId: observation.capabilityId,
    autonomous: false,
    key: `retired:${observation.id}`,
  });
}

export function routingCorrectedEvent(
  hint: RoutingHint,
  correctedFrom: string | undefined,
  at: Timestamp,
): EvolutionEvent {
  return evolutionEvent({
    scope: hint.scope,
    at,
    kind: 'routing-corrected',
    summary: `"${hint.phrase}" now goes to ${hint.specialistId}.`,
    detail: `Correction ${hint.weight}× — applied before keyword scoring from the next question on.`,
    ...(correctedFrom ? { before: correctedFrom } : {}),
    after: hint.specialistId,
    specialistId: hint.specialistId,
    autonomous: false,
    key: `routing:${hint.id}:${hint.weight}`,
  });
}

/* ------------------------------------------------------ decision events --- */

export interface DecisionEventInput {
  readonly scope: Scope;
  readonly at: Timestamp;
  readonly summary: string;
  readonly detail?: string;
  readonly capabilityId?: string;
  readonly specialistId?: string;
  readonly key?: string;
}

/**
 * A tool ran on its own — which is only ever possible for a `read` or `write`
 * tier. The gate lives in `requiresApproval`; this records the fact afterwards.
 */
export function toolUsedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'tool-used', autonomous: true });
}

export function toolApprovedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'tool-approved', autonomous: false });
}

export function toolRejectedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'tool-rejected', autonomous: false });
}

export function promotedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'promoted', autonomous: false });
}

export function agentAddedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'agent-added', autonomous: false });
}

export function agentChangedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'agent-changed', autonomous: false });
}

export function workspaceChangedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'workspace-changed', autonomous: false });
}

export function upgradeDecidedEvent(input: DecisionEventInput): EvolutionEvent {
  return evolutionEvent({ ...input, kind: 'upgrade-decided', autonomous: false });
}
