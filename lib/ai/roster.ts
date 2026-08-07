import 'server-only';

/**
 * The roster a scope actually has: built-ins merged with that scope's stored
 * agents. One scope is read and nothing else — a custom agent hired for one
 * company can never route, speak or be seated anywhere its scope does not reach.
 */

import type { Scope, SpecialistAgent } from '@/lib/domain';
import { mergeRoster } from '@/lib/domain';
import { readCollection } from '@/lib/data/store';
import { SPECIALISTS } from './specialists';

export async function rosterFor(scope: Scope): Promise<SpecialistAgent[]> {
  if (scope.kind === 'shared') return [...SPECIALISTS];
  const customAgents = await readCollection(scope, 'customAgents');
  return mergeRoster(SPECIALISTS, customAgents);
}

/** Name lookup over a merged roster, for transcripts and rooms. */
export function rosterNames(roster: readonly SpecialistAgent[]): Record<string, string> {
  return Object.fromEntries(roster.map((specialist) => [specialist.id, specialist.name]));
}
