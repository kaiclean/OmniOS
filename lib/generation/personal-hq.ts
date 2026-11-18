/**
 * Personal headquarters generation.
 *
 * Personal life is not a lighter version of a company — it is a full space with
 * its own DNA, its own capabilities and its own record types. It is generated the
 * same way a company is, through the same registry, which is what keeps the two
 * genuinely symmetrical instead of one being a bolted-on afterthought.
 *
 * This file is the assembly only. The generators live in `./personal-hq/`, grouped
 * by what they produce, and draw from the same seeded `Rng` in the order
 * `generatePersonalWorkspace` calls them, so the same life still produces the
 * same space. Split from one 730-line module; importers are unchanged.
 */

import type { PersonalProfile } from '@/lib/domain';
import { emptyScopeData, type ScopeData } from '@/lib/data/schema';
import { createRng } from './rng';
import { SEED } from './personal-hq/shared';
import { makePersonalProfile } from './personal-hq/profile';
import {
  makeCalendar,
  makeHabits,
  makeHealth,
  makeLearning,
  makeLifeAdmin,
  makeRelationships,
} from './personal-hq/life';
import { makeFinance, makeGoals, makeKpis, makeTasks } from './personal-hq/work';
import {
  makeAutomations,
  makeDocs,
  makeMemory,
  makeRisks,
  makeSuggestions,
} from './personal-hq/records';

export { makePersonalProfile } from './personal-hq/profile';

/* -------------------------------------------------------------- assembly -- */

export interface GeneratedPersonal {
  readonly profile: PersonalProfile;
  readonly data: ScopeData;
}

export function generatePersonalWorkspace(
  displayName: string,
  companyScopeKeys: readonly string[],
  now: Date = new Date(),
): GeneratedPersonal {
  const rng = createRng(SEED);
  const health = makeHealth(rng, now);

  const data: ScopeData = {
    ...emptyScopeData(),
    health,
    habits: makeHabits(rng, now),
    relationships: makeRelationships(rng, now),
    learning: makeLearning(rng, now),
    lifeAdmin: makeLifeAdmin(rng, now),
    calendar: makeCalendar(rng, now, companyScopeKeys),
    goals: makeGoals(rng, now),
    kpis: makeKpis(rng, now, health),
    tasks: makeTasks(rng, now),
    finance: makeFinance(rng, now),
    automations: makeAutomations(now),
    docs: makeDocs(now),
    suggestions: makeSuggestions(rng, now),
    risks: makeRisks(now),
    memory: makeMemory(now),
  };

  return { profile: makePersonalProfile(displayName, now), data };
}

/** Kept exported so tests and the reset flow can rebuild an empty-but-valid life. */
export function emptyPersonalWorkspace(displayName: string, now: Date = new Date()): GeneratedPersonal {
  return { profile: makePersonalProfile(displayName, now), data: emptyScopeData() };
}
