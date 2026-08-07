/**
 * What OmniOS notices.
 *
 * Learning starts here, and it starts *without a model*. Every detector below is
 * a rule over something that actually happened — the words the founder used, the
 * hour they used them at, the capability they were standing in, the
 * recommendation they threw away. Three things follow from that, and all three
 * are the reason it is written this way:
 *
 * - it works before any API key exists, so "learns with every interaction" is
 *   true of the shipped system rather than of a future one;
 * - it is deterministic, so a test can assert on it with plain equality;
 * - every conclusion can be shown to the founder with the evidence attached, so
 *   a wrong belief is arguable rather than mysterious.
 *
 * Nothing here writes, and nothing here decides how strongly to believe anything
 * over time. `observe` returns *candidates*. Whether a candidate is new knowledge
 * or the fourth sighting of something already known is settled in `reinforce.ts`,
 * which matches candidates to stored observations by id — which is why the id is
 * derived from a stable signature and never from the moment of observation.
 */

import type { Observation, ObservationKind, Scope, Timestamp } from '@/lib/domain';
import { makeRecordId, scopeKey } from '@/lib/domain';
import { getCapability } from '@/lib/capabilities/registry';

/* ------------------------------------------------------------- inputs ----- */

/** A record the answer actually leaned on. Becomes the observation's evidence. */
export interface TouchedRecord {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
}

export const INTERACTION_OUTCOMES = [
  'answered',
  'suggestion-accepted',
  'suggestion-dismissed',
  'decision-reversed',
  'routing-corrected',
] as const;
export type InteractionOutcome = (typeof INTERACTION_OUTCOMES)[number];

/**
 * One thing that happened, described completely enough to learn from.
 *
 * `at` is supplied by the caller rather than read from the clock: these detectors
 * are generators in the sense that matters, and an unseeded `new Date()` here
 * would make the founder's workspace reshuffle on reload and the tests unwritable.
 */
export interface Interaction {
  readonly scope: Scope;
  readonly prompt: string;
  readonly at: Timestamp;
  readonly capabilityId: string;
  readonly specialistId?: string;
  readonly touched?: readonly TouchedRecord[];
  readonly outcome?: InteractionOutcome;
  /** For a routing correction: who used to get this phrase. */
  readonly correctedFrom?: string;
}

/* --------------------------------------------------------- signatures ----- */

/**
 * The identity of a belief, independent of when it was formed.
 *
 * Two interactions that support the same conclusion must produce the same id, or
 * reinforcement is impossible and the store fills with near-duplicates instead of
 * one belief getting stronger.
 */
export function observationId(scope: Scope, signature: string): string {
  return makeRecordId('obs', `${scopeKey(scope)}:${signature}`);
}

interface Candidate {
  readonly kind: ObservationKind;
  readonly signature: string;
  readonly text: string;
  readonly confidence: number;
  readonly source: Observation['source'];
}

/**
 * Opening confidence by kind.
 *
 * A thing the founder said outright starts higher than a thing inferred from one
 * timestamp. Nothing starts near certainty: a first sighting should be visible
 * but weak, and earn the rest.
 */
const OPENING_CONFIDENCE: Record<ObservationKind, number> = {
  style: 0.28,
  pattern: 0.3,
  preference: 0.32,
  outcome: 0.45,
  constraint: 0.55,
  correction: 0.6,
};

/* ------------------------------------------------------------- detectors -- */

const PHRASE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'my', 'me', 'i',
  'we', 'do', 'should', 'what', 'how', 'can', 'you', 'this', 'that', 'with', 'about', 'please',
  'am', 'are', 'be', 'been', 'was', 'were', 'at', 'by', 'from', 'as', 'so', 'if', 'then', 'have',
]);

/** The words that carry the request, in the order the founder said them. */
export function significantWords(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !PHRASE_STOPWORDS.has(word));
}

function phrasing(prompt: string): Candidate | null {
  const words = significantWords(prompt).slice(0, 5);
  if (words.length < 2) return null;
  const phrase = words.join(' ');
  return {
    kind: 'style',
    signature: `phrasing:${phrase}`,
    text: `Asks in these words: "${phrase}".`,
    confidence: OPENING_CONFIDENCE.style,
    source: 'interaction',
  };
}

interface HourBand {
  readonly id: string;
  readonly until: number;
  readonly label: string;
}

/** `until` is exclusive; the list is scanned in order and the last band closes the day. */
const HOUR_BANDS: readonly HourBand[] = [
  { id: 'night', until: 5, label: 'late at night (00:00–05:00)' },
  { id: 'early-morning', until: 9, label: 'in the early morning (05:00–09:00)' },
  { id: 'late-morning', until: 12, label: 'in the late morning (09:00–12:00)' },
  { id: 'afternoon', until: 18, label: 'in the afternoon (12:00–18:00)' },
  { id: 'evening', until: 24, label: 'in the evening (18:00–24:00)' },
];

/**
 * The hour is read out of the timestamp text rather than through `Date#getHours`.
 * `getHours` answers in the timezone of whatever machine happens to be rendering,
 * which would make the same stored interaction produce a different observation in
 * CI than on the founder's laptop.
 */
export function hourOf(at: Timestamp): number | null {
  const match = /T(\d{2}):/.exec(at);
  const raw = match?.[1];
  if (raw === undefined) return null;
  const hour = Number(raw);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function workingHour(at: Timestamp): Candidate | null {
  const hour = hourOf(at);
  if (hour === null) return null;
  const band = HOUR_BANDS.find((b) => hour < b.until) ?? HOUR_BANDS[HOUR_BANDS.length - 1];
  if (!band) return null;
  return {
    kind: 'pattern',
    signature: `works:${band.id}`,
    text: `Works ${band.label}.`,
    confidence: OPENING_CONFIDENCE.pattern,
    source: 'interaction',
  };
}

function capabilityName(capabilityId: string): string {
  return getCapability(capabilityId)?.name ?? capabilityId;
}

function capabilityFocus(capabilityId: string): Candidate {
  return {
    kind: 'preference',
    signature: `focus:${capabilityId}`,
    text: `Brings ${capabilityName(capabilityId)} questions to the assistant.`,
    confidence: OPENING_CONFIDENCE.preference,
    source: 'interaction',
  };
}

/**
 * Words a founder uses when they are stating a rule rather than asking a question.
 * Deliberately narrow: a false constraint is the most annoying thing this engine
 * can learn, because it then shapes every later answer.
 */
const CONSTRAINT_MARKERS: readonly RegExp[] = [
  /\bnever\b/,
  /\bdon'?t ever\b/,
  /\bdo not ever\b/,
  /\balways\b/,
  /\bi only\b/,
  /\bno more than\b/,
  /\bat most\b/,
  /\bunder no circumstances\b/,
];

function constraint(prompt: string): Candidate | null {
  const clauses = prompt
    .split(/[.!?;\n]+/)
    .map((clause) => clause.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    if (!CONSTRAINT_MARKERS.some((marker) => marker.test(lower))) continue;
    const trimmed = clause.slice(0, 160);
    return {
      kind: 'constraint',
      signature: `constraint:${lower.slice(0, 160)}`,
      text: `Stated a rule: "${trimmed}".`,
      confidence: OPENING_CONFIDENCE.constraint,
      source: 'founder',
    };
  }
  return null;
}

function fromOutcome(interaction: Interaction): Candidate | null {
  const name = capabilityName(interaction.capabilityId);
  switch (interaction.outcome) {
    case 'suggestion-dismissed':
      return {
        kind: 'outcome',
        signature: `dismisses:${interaction.capabilityId}`,
        text: `Dismisses ${name} recommendations rather than acting on them.`,
        confidence: OPENING_CONFIDENCE.outcome,
        source: 'outcome',
      };
    case 'suggestion-accepted':
      return {
        kind: 'outcome',
        signature: `accepts:${interaction.capabilityId}`,
        text: `Acts on ${name} recommendations.`,
        confidence: OPENING_CONFIDENCE.outcome,
        source: 'outcome',
      };
    case 'decision-reversed':
      return {
        kind: 'correction',
        signature: `reverses:${interaction.capabilityId}`,
        text: `Reverses ${name} decisions after making them.`,
        confidence: OPENING_CONFIDENCE.correction,
        source: 'correction',
      };
    case 'routing-corrected': {
      const words = significantWords(interaction.prompt).slice(0, 5).join(' ');
      if (!words || !interaction.specialistId) return null;
      const from = interaction.correctedFrom ? ` rather than to ${interaction.correctedFrom}` : '';
      return {
        kind: 'correction',
        signature: `routing:${words}`,
        text: `Sends "${words}" to ${interaction.specialistId}${from}.`,
        confidence: OPENING_CONFIDENCE.correction,
        source: 'correction',
      };
    }
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- api ----- */

const MAX_EVIDENCE = 4;

function evidenceFor(interaction: Interaction): string[] {
  const excerpt = interaction.prompt.trim().replace(/\s+/g, ' ').slice(0, 140);
  const touched = (interaction.touched ?? []).map((record) => `${record.kind}: ${record.label}`);
  return [...new Set([excerpt, ...touched].filter(Boolean))].slice(0, MAX_EVIDENCE);
}

/**
 * Everything this interaction supports believing.
 *
 * Candidates are unsaved: confidence is an opening bid and `reinforcements` is
 * zero even for something the system has seen fifty times, because merging with
 * what is already stored is `reinforce.ts`'s job and doing it here would need a
 * store read inside a pure function.
 */
export function observe(interaction: Interaction): Observation[] {
  const candidates: Candidate[] = [];
  const push = (candidate: Candidate | null): void => {
    if (candidate) candidates.push(candidate);
  };

  push(phrasing(interaction.prompt));
  push(workingHour(interaction.at));
  push(capabilityFocus(interaction.capabilityId));
  push(constraint(interaction.prompt));
  push(fromOutcome(interaction));

  const evidence = evidenceFor(interaction);

  return candidates.map((candidate) => ({
    id: observationId(interaction.scope, candidate.signature),
    scope: interaction.scope,
    createdAt: interaction.at,
    updatedAt: interaction.at,
    kind: candidate.kind,
    text: candidate.text,
    capabilityId: interaction.capabilityId,
    confidence: candidate.confidence,
    evidence,
    source: candidate.source,
    reinforcements: 0,
    lastSeenAt: interaction.at,
  }));
}
