/**
 * Routing hints — the correction that actually changes the next answer.
 *
 * When the founder says "that should have gone to the analyst, not the finance
 * lead", a system that logs the complaint and keeps routing the same way has not
 * learned anything. So a correction is stored as a hint, and the router consults
 * hints *before* it scores keywords. The same sentence routes differently
 * afterwards — which is the smallest honest demonstration that the thing learns.
 *
 * Two boundaries are load-bearing:
 *
 * - This module knows nothing about `lib/ai`. The router depends on learning;
 *   learning never depends on the router. `HintableScore` is the structural
 *   contract between them, which is why it is declared here rather than imported.
 * - Eligibility is the caller's job. `scoreWithHints` only ever re-weights
 *   specialists that were handed to it, so a hint recorded in personal life can
 *   never smuggle a personal-only specialist into a company's routing.
 */

import type { RoutingHint, Scope, Timestamp } from '@/lib/domain';
import { makeRecordId, scopeKey } from '@/lib/domain';

/**
 * A deliberately small stopword list, kept separate from the router's.
 *
 * The router tunes its list for keyword scoring; this one exists to produce a
 * stable *key* for a phrase. Sharing one set would couple two things that need to
 * change for unrelated reasons — and would force learning to import from lib/ai.
 */
const KEY_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'my', 'me', 'i',
  'we', 'do', 'should', 'what', 'how', 'can', 'you', 'this', 'that', 'with', 'about', 'please',
  'am', 'are', 'be', 'was', 'were', 'at', 'by', 'from', 'as', 'so', 'if', 'then', 'have',
]);

const KEY_WORDS = 6;

/**
 * The stable key for a phrase.
 *
 * Punctuation, filler and word count are stripped so that "How is cash flow
 * looking?" and "how is the cash flow looking" resolve to the same hint. Word
 * order is kept: "sales pipeline" and "pipeline sales" are different questions.
 */
export function hintPhrase(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !KEY_STOPWORDS.has(word))
    .slice(0, KEY_WORDS)
    .join(' ');
}

export function hintId(scope: Scope, phrase: string): string {
  return makeRecordId('hint', `${scopeKey(scope)}:${phrase}`);
}

/* ------------------------------------------------------------ matching ---- */

export interface HintMatch {
  readonly hint: RoutingHint;
  /** True when the founder corrected this exact phrase, not a longer one containing it. */
  readonly exact: boolean;
  readonly bonus: number;
}

/** Repeated corrections count, but a hint cannot grow unboundedly dominant. */
const MAX_WEIGHT_CONSIDERED = 6;

function bonusFor(hint: RoutingHint, exact: boolean): number {
  const weight = Math.min(Math.max(hint.weight, 1), MAX_WEIGHT_CONSIDERED);
  return Number(((exact ? 1.5 : 0.75) + weight * 0.5).toFixed(4));
}

/**
 * The hint that claims this prompt, if any.
 *
 * An exact key match beats a containment match; among equals the most-corrected
 * hint wins, and ties break on id so routing stays deterministic.
 */
export function matchHint(hints: readonly RoutingHint[], prompt: string): HintMatch | null {
  const key = hintPhrase(prompt);
  if (!key) return null;

  let best: HintMatch | null = null;
  for (const hint of hints) {
    if (!hint.phrase) continue;
    const exact = hint.phrase === key;
    const matches = exact || key.includes(hint.phrase);
    if (!matches) continue;

    const candidate: HintMatch = { hint, exact, bonus: bonusFor(hint, exact) };
    if (
      !best ||
      (candidate.exact && !best.exact) ||
      (candidate.exact === best.exact &&
        (candidate.hint.weight > best.hint.weight ||
          (candidate.hint.weight === best.hint.weight &&
            candidate.hint.id.localeCompare(best.hint.id) < 0)))
    ) {
      best = candidate;
    }
  }
  return best;
}

/* -------------------------------------------------------------- scoring --- */

/** The structural contract with whatever is doing the scoring. */
export interface HintableScore {
  readonly specialistId: string;
  readonly score: number;
}

export interface HintedScore extends HintableScore {
  readonly hintId?: string;
  readonly hintPhrase?: string;
  readonly hintWeight?: number;
  readonly hintExact?: boolean;
}

/**
 * Re-weight keyword scores with what the founder has already corrected.
 *
 * An **exact** hit lifts its specialist above the current leader and then adds
 * the bonus, so the correction wins outright — that is the whole point, and a
 * hint only exists because a human explicitly said so.
 *
 * A **containment** hit only adds the bonus to the specialist's own score, so a
 * hint learned from one sentence nudges a longer, different sentence rather than
 * hijacking it.
 *
 * Specialists absent from `scores` are never added. A hint cannot introduce a
 * specialist the caller judged ineligible for this scope.
 */
export function scoreWithHints(
  scores: readonly HintableScore[],
  hints: readonly RoutingHint[],
  prompt: string,
): HintedScore[] {
  const byScore = (a: HintedScore, b: HintedScore): number =>
    b.score - a.score || a.specialistId.localeCompare(b.specialistId);

  const match = matchHint(hints, prompt);
  if (!match) return [...scores].sort(byScore);

  const leader = scores.reduce((max, entry) => Math.max(max, entry.score), 0);

  return scores
    .map((entry) => {
      if (entry.specialistId !== match.hint.specialistId) return { ...entry };
      const base = match.exact ? Math.max(entry.score, leader) : entry.score;
      return {
        ...entry,
        score: Number((base + match.bonus).toFixed(4)),
        hintId: match.hint.id,
        hintPhrase: match.hint.phrase,
        hintWeight: match.hint.weight,
        hintExact: match.exact,
      };
    })
    .sort(byScore);
}

/* --------------------------------------------------------------- writes --- */

export interface CorrectionInput {
  readonly scope: Scope;
  readonly prompt: string;
  readonly specialistId: string;
  readonly correctedFrom?: string;
  readonly at: Timestamp;
}

export interface CorrectionOutcome {
  readonly hints: readonly RoutingHint[];
  readonly hint: RoutingHint;
  readonly created: boolean;
}

/**
 * Record a correction.
 *
 * Correcting the same phrase again raises the weight rather than adding a second
 * hint — repetition is how the founder says "I meant it", and it has to be
 * visible as one strengthening rule instead of a pile of identical ones. A
 * correction pointing the same phrase somewhere new overwrites the target and
 * keeps the accumulated weight: the founder is still sure, just about someone else.
 */
export function recordCorrection(
  hints: readonly RoutingHint[],
  input: CorrectionInput,
): CorrectionOutcome {
  const phrase = hintPhrase(input.prompt);
  const id = hintId(input.scope, phrase);
  const existing = hints.find((hint) => hint.id === id);

  const hint: RoutingHint = existing
    ? {
        ...existing,
        specialistId: input.specialistId,
        weight: existing.weight + 1,
        updatedAt: input.at,
        ...(input.correctedFrom ? { correctedFrom: input.correctedFrom } : {}),
      }
    : {
        id,
        scope: input.scope,
        createdAt: input.at,
        updatedAt: input.at,
        phrase,
        specialistId: input.specialistId,
        weight: 1,
        applications: 0,
        ...(input.correctedFrom ? { correctedFrom: input.correctedFrom } : {}),
      };

  return {
    hints: existing ? hints.map((entry) => (entry.id === id ? hint : entry)) : [hint, ...hints],
    hint,
    created: !existing,
  };
}

/** Records that a hint actually steered a route, so the founder can see it working. */
export function markHintApplied(
  hints: readonly RoutingHint[],
  id: string,
  at: Timestamp,
): RoutingHint[] {
  return hints.map((hint) =>
    hint.id === id
      ? { ...hint, applications: hint.applications + 1, lastAppliedAt: at, updatedAt: at }
      : hint,
  );
}
