/**
 * Context assembly for the Executive Assistant.
 *
 * Two modes, and the difference matters:
 *
 * - **Space mode** — the founder is inside a company or inside personal life. The
 *   assistant sees that scope and the shared capability memory, and nothing else.
 *   No other company. Not personal life. This is the isolation guarantee.
 *
 * - **Founder mode** — the founder is at the OS level asking a question that spans
 *   their whole world ("what should I do today?"). Aggregating their *own* spaces
 *   is the entire reason life and business live in one system. Every fact carries
 *   the space it came from, and this mode is never entered on behalf of a company.
 *
 * A scoped conversation cannot silently become a founder-mode one: the mode is
 * chosen by the caller, from the route, and is shown in the UI.
 */

import type {
  Automation,
  CalendarBlock,
  Company,
  Contact,
  FinanceEntry,
  Goal,
  Habit,
  HealthDay,
  Kpi,
  LearningItem,
  LifeAdminItem,
  MemoryRecord,
  PersonalProfile,
  Relationship,
  RiskItem,
  Scope,
  Suggestion,
  Task,
} from '@/lib/domain';
import { personalScope, scopeKey, sharedScope } from '@/lib/domain';
import type { ScopeData } from '@/lib/data/schema';
import { capabilityIds } from '@/lib/capabilities/registry';

export type AssistantTarget =
  | { readonly kind: 'space'; readonly scope: Scope }
  | { readonly kind: 'founder' };

export interface SpaceSlice {
  readonly scopeKey: string;
  readonly label: string;
  readonly spaceKind: 'company' | 'personal';
  readonly data: ScopeData;
}

export interface AssistantContext {
  readonly target: AssistantTarget;
  /** One entry in space mode; every owned space in founder mode. */
  readonly slices: readonly SpaceSlice[];
  readonly sharedMemory: readonly MemoryRecord[];
  readonly companies: readonly Company[];
  readonly personal: PersonalProfile;
  readonly now: Date;
}

/** Flat, cross-slice views used by the composers. Each item keeps its origin. */
export interface Origin<T> {
  readonly item: T;
  readonly spaceLabel: string;
  readonly scopeKey: string;
  readonly spaceKind: 'company' | 'personal';
}

function collect<K extends keyof ScopeData>(
  ctx: AssistantContext,
  key: K,
): Array<Origin<ScopeData[K][number]>> {
  const out: Array<Origin<ScopeData[K][number]>> = [];
  for (const slice of ctx.slices) {
    for (const item of slice.data[key]) {
      out.push({
        item,
        spaceLabel: slice.label,
        scopeKey: slice.scopeKey,
        spaceKind: slice.spaceKind,
      });
    }
  }
  return out;
}

export const tasksOf = (c: AssistantContext): Array<Origin<Task>> => collect(c, 'tasks');
export const goalsOf = (c: AssistantContext): Array<Origin<Goal>> => collect(c, 'goals');
export const kpisOf = (c: AssistantContext): Array<Origin<Kpi>> => collect(c, 'kpis');
export const risksOf = (c: AssistantContext): Array<Origin<RiskItem>> => collect(c, 'risks');
export const suggestionsOf = (c: AssistantContext): Array<Origin<Suggestion>> =>
  collect(c, 'suggestions');
export const automationsOf = (c: AssistantContext): Array<Origin<Automation>> =>
  collect(c, 'automations');
export const contactsOf = (c: AssistantContext): Array<Origin<Contact>> => collect(c, 'contacts');
export const financeOf = (c: AssistantContext): Array<Origin<FinanceEntry>> =>
  collect(c, 'finance');
export const memoryOf = (c: AssistantContext): Array<Origin<MemoryRecord>> => collect(c, 'memory');
export const healthOf = (c: AssistantContext): Array<Origin<HealthDay>> => collect(c, 'health');
export const habitsOf = (c: AssistantContext): Array<Origin<Habit>> => collect(c, 'habits');
export const relationshipsOf = (c: AssistantContext): Array<Origin<Relationship>> =>
  collect(c, 'relationships');
export const learningOf = (c: AssistantContext): Array<Origin<LearningItem>> =>
  collect(c, 'learning');
export const lifeAdminOf = (c: AssistantContext): Array<Origin<LifeAdminItem>> =>
  collect(c, 'lifeAdmin');
export const calendarOf = (c: AssistantContext): Array<Origin<CalendarBlock>> =>
  collect(c, 'calendar');

/** The scopes a target is permitted to read. Used by the loader; never widened elsewhere. */
export function scopesForTarget(target: AssistantTarget, companies: readonly Company[]): Scope[] {
  const shared = capabilityIds().map(sharedScope);
  if (target.kind === 'founder') {
    return [...companies.map((c) => ({ kind: 'company' as const, companyId: c.id })), personalScope(), ...shared];
  }
  return [target.scope, ...shared];
}

export function targetKey(target: AssistantTarget): string {
  return target.kind === 'founder' ? 'founder' : scopeKey(target.scope);
}

export function targetLabel(
  target: AssistantTarget,
  companies: readonly Company[],
  personalName: string,
): string {
  if (target.kind === 'founder') return 'Everything';
  switch (target.scope.kind) {
    case 'personal':
      return personalName;
    case 'company': {
      const id = target.scope.companyId;
      return companies.find((c) => c.id === id)?.name ?? id;
    }
    case 'shared':
      return 'Shared knowledge';
  }
}
