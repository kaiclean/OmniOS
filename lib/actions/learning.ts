'use server';

import { revalidatePath } from 'next/cache';

import type {
  EvolutionEvent,
  Observation,
  Scope,
  Suggestion,
  SuggestionStatus,
  Timestamp,
} from '@/lib/domain';
import { getSpecialist } from '@/lib/ai/specialists';
import { loadSpaces } from '@/lib/data/aggregate';
import { mutateScope } from '@/lib/data/store';
import { observe } from '@/lib/learning/observe';
import type { Interaction } from '@/lib/learning/observe';
import {
  confirmed,
  mergeObservations,
  recordSpecialistEvent,
  retired,
} from '@/lib/learning/reinforce';
import {
  appendEvolution,
  evolutionEvent,
  learnedEvent,
  reinforcedEvent,
  retiredEvent,
  routingCorrectedEvent,
} from '@/lib/learning/evolution';
import { recordCorrection } from '@/lib/learning/routing';

/**
 * The four ways a founder talks back to the learning engine.
 *
 * Every one of them resolves the posted id by *finding the scope that actually
 * holds the record*, and then writes only to that scope. An id from the browser
 * is a claim, not an address: trusting it would make scope isolation a convention
 * instead of a structure.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const OK: ActionResult = { ok: true };

/** Locates the one scope holding a record, or nothing. Never widens the search. */
async function findScope<T extends { id: string }>(
  pick: (space: Awaited<ReturnType<typeof loadSpaces>>[number]) => readonly T[],
  id: string,
): Promise<{ scope: Scope; kind: 'company' | 'personal'; record: T } | null> {
  for (const space of await loadSpaces()) {
    const record = pick(space).find((entry) => entry.id === id);
    if (record) return { scope: space.scope, kind: space.kind, record };
  }
  return null;
}

/* ---------------------------------------------------- routing correction -- */

/**
 * "That should have gone to someone else."
 *
 * The correction is stored as a routing hint, and the router consults hints
 * before it scores keywords — so the next identical question routes differently.
 * A correction that only produced a log entry would be a complaint box.
 */
export async function correctRouting(runId: string, specialistId: string): Promise<ActionResult> {
  const specialist = getSpecialist(specialistId);
  if (!specialist) return { ok: false, error: 'That is not a specialist this system has.' };

  const found = await findScope((space) => space.data.agentRuns, runId);
  if (!found) return { ok: false, error: 'That run no longer exists.' };

  if (!specialist.allowedScopeKinds.includes(found.kind)) {
    return {
      ok: false,
      error: `${specialist.name} is never available in a ${found.kind} space.`,
    };
  }

  const previous = found.record.plan.steps[0]?.specialistId;
  if (previous === specialistId) {
    return { ok: false, error: `${specialist.name} already handled that.` };
  }

  const at = new Date().toISOString();
  const now = new Date(at);
  const prompt = found.record.prompt;

  await mutateScope(found.scope, (data) => {
    const correction = recordCorrection(data.routingHints, {
      scope: found.scope,
      prompt,
      specialistId,
      at,
      ...(previous ? { correctedFrom: previous } : {}),
    });

    const interaction: Interaction = {
      scope: found.scope,
      prompt,
      at,
      capabilityId: specialist.capabilityIds[0] ?? 'executive',
      specialistId,
      outcome: 'routing-corrected',
      ...(previous ? { correctedFrom: previous } : {}),
    };
    const merge = mergeObservations(data.observations, observe(interaction), now);

    const scores = previous
      ? recordSpecialistEvent(data.specialistScores, {
          scope: found.scope,
          specialistId: previous,
          event: 'routing-corrected',
          at,
        }).scores
      : data.specialistScores;

    return {
      ...data,
      routingHints: [...correction.hints],
      observations: [...merge.observations],
      specialistScores: [...scores],
      evolution: appendEvolution(data.evolution, [
        routingCorrectedEvent(correction.hint, previous, at),
        ...merge.learned.map((observation) => learnedEvent(observation, at)),
        ...merge.reinforced.map((entry) => reinforcedEvent(entry.before, entry.after, at)),
      ]),
    };
  });

  revalidatePath('/', 'layout');
  return OK;
}

/* ------------------------------------------------------- belief decisions -- */

async function updateObservation(
  observationId: string,
  change: (observation: Observation, at: Timestamp) => Observation,
  event: (observation: Observation, updated: Observation, at: Timestamp) => EvolutionEvent,
  missing: string,
): Promise<ActionResult> {
  const found = await findScope((space) => space.data.observations, observationId);
  if (!found) return { ok: false, error: missing };

  const at = new Date().toISOString();

  await mutateScope(found.scope, (data) => {
    const current = data.observations.find((entry) => entry.id === observationId);
    if (!current) return data;
    const updated = change(current, at);
    return {
      ...data,
      observations: data.observations.map((entry) =>
        entry.id === observationId ? updated : entry,
      ),
      evolution: appendEvolution(data.evolution, [event(current, updated, at)]),
    };
  });

  revalidatePath('/', 'layout');
  return OK;
}

/**
 * "Stop believing that about me."
 *
 * Retirement is permanent by design: `mergeObservations` refuses to re-learn a
 * retired belief however often the pattern recurs. The record itself stays, so
 * the evolution log keeps its account of what the system once concluded.
 */
export async function retireObservation(observationId: string): Promise<ActionResult> {
  return updateObservation(
    observationId,
    retired,
    (current, _updated, at) => retiredEvent(current, at),
    'That observation no longer exists.',
  );
}

/** "Yes, that is true of me." Worth more than another sighting, and not autonomous. */
export async function confirmObservation(observationId: string): Promise<ActionResult> {
  return updateObservation(
    observationId,
    confirmed,
    (current, updated, at) =>
      evolutionEvent({
        scope: updated.scope,
        at,
        kind: 'reinforced',
        summary: `Confirmed by you: ${updated.text.slice(0, 120)}`,
        before: current.confidence.toFixed(2),
        after: updated.confidence.toFixed(2),
        capabilityId: updated.capabilityId,
        autonomous: false,
        key: `confirmed:${updated.id}:${updated.reinforcements}`,
      }),
    'That observation no longer exists.',
  );
}

/* ------------------------------------------------------ suggestion outcome -- */

const DECISIONS: Record<string, Extract<SuggestionStatus, 'accepted' | 'dismissed'>> = {
  accepted: 'accepted',
  dismissed: 'dismissed',
};

/**
 * What the founder did with a recommendation.
 *
 * This is the only signal that tells OmniOS whether its own specialists are worth
 * listening to, so it updates the specialist's score and lets the pattern of
 * dismissals become an observation in its own right — a specialist whose advice
 * is always thrown away should end up saying so out loud.
 */
export async function recordSuggestionDecision(
  suggestionId: string,
  decision: string,
): Promise<ActionResult> {
  const status = DECISIONS[decision];
  if (!status) return { ok: false, error: 'That is not a decision a suggestion accepts.' };

  const found = await findScope<Suggestion>((space) => space.data.suggestions, suggestionId);
  if (!found) return { ok: false, error: 'That recommendation no longer exists.' };
  if (found.record.status === status) return OK;

  const at = new Date().toISOString();
  const now = new Date(at);
  const suggestion = found.record;

  await mutateScope(found.scope, (data) => {
    const interaction: Interaction = {
      scope: found.scope,
      prompt: suggestion.title,
      at,
      capabilityId: suggestion.capabilityId,
      specialistId: suggestion.specialistId,
      outcome: status === 'accepted' ? 'suggestion-accepted' : 'suggestion-dismissed',
    };
    const merge = mergeObservations(data.observations, observe(interaction), now);

    const scores = recordSpecialistEvent(data.specialistScores, {
      scope: found.scope,
      specialistId: suggestion.specialistId,
      event: status,
      at,
    }).scores;

    return {
      ...data,
      suggestions: data.suggestions.map((entry) =>
        entry.id === suggestionId ? { ...entry, status, updatedAt: at } : entry,
      ),
      observations: [...merge.observations],
      specialistScores: [...scores],
      evolution: appendEvolution(data.evolution, [
        ...merge.learned.map((observation) => learnedEvent(observation, at)),
        ...merge.reinforced.map((entry) => reinforcedEvent(entry.before, entry.after, at)),
      ]),
    };
  });

  revalidatePath('/', 'layout');
  return OK;
}
