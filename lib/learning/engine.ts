import 'server-only';

/**
 * Where learning meets the store.
 *
 * Everything else under `lib/learning/` is pure: it takes records and returns
 * records. This module is the only part that reads and writes, and it exists so
 * that purity is possible — a learning engine that reached into the store from
 * inside its own rules could not be tested without a filesystem, and would end up
 * untested.
 *
 * The scope discipline is the same as everywhere else: every write names a scope,
 * and the ids being written were read out of that same scope a moment earlier.
 * Memory reinforcement is the one place that touches more than one scope, and it
 * does so by walking the scope keys the records themselves carry — never by
 * aggregating first and writing afterwards.
 */

import type { ContextReference } from '@/lib/domain';
import { parseScopeKey } from '@/lib/domain';
import { mutateScope } from '@/lib/data/store';
import type { Interaction } from './observe';
import { observe } from './observe';
import {
  fadedObservations,
  mergeObservations,
  recordSpecialistEvents,
  reinforceMemories,
  strengthOf,
} from './reinforce';
import type { ScoreInput } from './reinforce';
import { appendEvolution, decayedEvent, learnedEvent, reinforcedEvent } from './evolution';
import { markHintApplied } from './routing';

export interface LearnInput {
  readonly interaction: Interaction;
  readonly now: Date;
  /** Every specialist consulted for this interaction. Each one gets an invocation. */
  readonly specialistIds?: readonly string[];
  /** References the answer was built from. Memory entries among them are reinforced. */
  readonly used?: readonly ContextReference[];
  /** Set when a stored correction, rather than the keywords, decided the route. */
  readonly appliedHintId?: string;
}

export interface LearnSummary {
  readonly learned: number;
  readonly reinforced: number;
  readonly faded: number;
  readonly memoryReinforced: number;
}

/**
 * Fold one interaction into what the scope knows.
 *
 * Done as a single read-modify-write per scope, so an interaction cannot leave
 * observations updated but the evolution log missing the reason why. The decay
 * sweep rides along here rather than on a timer: decay is computed on read
 * anyway, and this is simply where it becomes visible in the log.
 */
export async function learnFromInteraction(input: LearnInput): Promise<LearnSummary> {
  const { interaction, now } = input;
  const at = interaction.at;

  let learned = 0;
  let reinforced = 0;
  let faded = 0;

  await mutateScope(interaction.scope, (data) => {
    const merge = mergeObservations(data.observations, observe(interaction), now);
    const fading = fadedObservations(data.observations, now);

    learned = merge.learned.length;
    reinforced = merge.reinforced.length;
    faded = fading.length;

    const events = [
      ...merge.learned.map((observation) => learnedEvent(observation, at)),
      ...merge.reinforced.map((entry) => reinforcedEvent(entry.before, entry.after, at)),
      ...fading.map((observation) => decayedEvent(observation, strengthOf(observation, now), at)),
    ];

    const invocations: ScoreInput[] = (input.specialistIds ?? []).map((specialistId) => ({
      scope: interaction.scope,
      specialistId,
      event: 'invoked',
      at,
    }));

    return {
      ...data,
      observations: [...merge.observations],
      evolution: appendEvolution(data.evolution, events),
      specialistScores: [...recordSpecialistEvents(data.specialistScores, invocations)],
      routingHints: input.appliedHintId
        ? markHintApplied(data.routingHints, input.appliedHintId, at)
        : data.routingHints,
    };
  });

  const memoryReinforced = await reinforceUsedMemory(input.used ?? [], now, at);

  return { learned, reinforced, faded, memoryReinforced };
}

/**
 * Strengthen the memory records that were actually used to answer.
 *
 * Grouped by the scope key each reference carries, because a founder-mode answer
 * legitimately draws on several of the founder's own spaces plus shared
 * capability memory — and each of those records has to be written back where it
 * came from, not into whichever scope happened to ask the question.
 */
async function reinforceUsedMemory(
  used: readonly ContextReference[],
  now: Date,
  at: string,
): Promise<number> {
  const idsByScopeKey = new Map<string, string[]>();
  for (const reference of used) {
    if (reference.kind !== 'memory') continue;
    const ids = idsByScopeKey.get(reference.scopeKey) ?? [];
    ids.push(reference.id);
    idsByScopeKey.set(reference.scopeKey, ids);
  }

  let count = 0;
  for (const [key, ids] of idsByScopeKey) {
    const scope = parseScopeKey(key);
    if (!scope) continue;
    await mutateScope(scope, (data) => {
      const outcome = reinforceMemories(data.memory, ids, now, at);
      count += outcome.reinforced.length;
      return { ...data, memory: [...outcome.memory] };
    });
  }
  return count;
}
