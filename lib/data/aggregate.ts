import 'server-only';

/**
 * Founder-level aggregation.
 *
 * The one place cross-space *reporting* lives — the overview, the timeline —
 * because the founder owns every space and a unified view is the point of the
 * product. The quarantine is about imports, and it is mechanical: nothing under
 * `lib/ai/` may import this file, and `tests/boundaries.test.ts` fails the build
 * if anything does. Founder-mode agent context is assembled separately, in
 * `lib/ai/assistant.ts`, by reading each owned scope by name — same data rights,
 * different code path, so a reporting helper added here never widens what a
 * model is handed.
 *
 * The setup-progress and timeline reports live in `./aggregate/`. They are part
 * of the same quarantine: the path contains `data/aggregate`, so the boundary
 * test rejects an import of any of them from under `lib/ai/`. Split from one
 * 564-line module; importers are unchanged.
 */

import {
  companyScope,
  personalScope,
  type CurrencyCode,
  type Suggestion,
  type Task,
} from '@/lib/domain';
import { energyOf } from '@/lib/personal/energy';
import type { ScopeData } from './schema';
import { getWorkspace, readScope } from './store';
import type { SpaceView } from './aggregate/types';

export type { SpaceView } from './aggregate/types';
export { setupProgress } from './aggregate/setup';
export type { SetupStep, SetupProgress } from './aggregate/setup';
export { TIMELINE_KINDS, TIMELINE_KIND_LABELS, buildTimeline } from './aggregate/timeline';
export type { TimelineKind, TimelineEvent, TimelineFilter } from './aggregate/timeline';

export async function loadSpaces(): Promise<SpaceView[]> {
  const workspace = await getWorkspace();
  const spaces: SpaceView[] = [];

  for (const company of workspace.companies) {
    if (company.archivedAt) continue;
    const scope = companyScope(company.id);
    spaces.push({
      scope,
      scopeKey: `company:${company.id}`,
      id: company.id,
      label: company.name,
      kind: 'company',
      href: `/companies/${company.id}`,
      data: await readScope(scope),
    });
  }

  spaces.push({
    scope: personalScope(),
    scopeKey: 'personal',
    id: 'personal',
    label: workspace.personal.displayName,
    kind: 'personal',
    href: '/life',
    data: await readScope(personalScope()),
  });

  return spaces;
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export interface MoneyRollup {
  readonly inMinor: number;
  readonly outMinor: number;
  readonly netMinor: number;
  readonly currency: CurrencyCode;
  /** How many ledger rows the sums are made of — zero means the figures are absence, not CHF 0. */
  readonly entries: number;
  /** True when any counted row was invented by a generator; the UI must say so. */
  readonly includesSimulated: boolean;
}

/**
 * Month-to-date money across a set of spaces.
 *
 * Forecast rows are excluded: a founder glancing at the overview strip must be
 * looking at what happened, not at what a generator predicted.
 */
export function moneyThisMonth(spaces: readonly SpaceView[], now = new Date()): MoneyRollup {
  const key = monthKey(now);
  let inMinor = 0;
  let outMinor = 0;
  let currency: CurrencyCode = 'CHF';
  let entries = 0;
  let includesSimulated = false;
  for (const space of spaces) {
    for (const entry of space.data.finance) {
      if (!entry.date.startsWith(key)) continue;
      if (entry.confidence === 'forecast') continue;
      currency = entry.amount.currency;
      entries += 1;
      if (entry.simulated) includesSimulated = true;
      if (entry.direction === 'in') inMinor += entry.amount.amount;
      else outMinor += entry.amount.amount;
    }
  }
  return { inMinor, outMinor, netMinor: inMinor - outMinor, currency, entries, includesSimulated };
}

export interface OverviewSnapshot {
  readonly money: MoneyRollup;
  readonly energy: number | null;
  readonly tasksDoneToday: number;
  readonly tasksOpen: number;
  readonly openSuggestions: number;
  readonly unreadNotifications: number;
  readonly upgradesAwaiting: number;
  readonly topPriorities: readonly { task: Task; spaceLabel: string; href: string }[];
}

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;

export async function overviewSnapshot(now = new Date()): Promise<OverviewSnapshot> {
  const [workspace, spaces] = await Promise.all([getWorkspace(), loadSpaces()]);
  const today = now.toISOString().slice(0, 10);

  const personal = spaces.find((s) => s.kind === 'personal');
  const latestHealth = personal?.data.health
    .filter((d) => d.sleepHours !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  let tasksDoneToday = 0;
  let tasksOpen = 0;
  let openSuggestions = 0;
  let unreadNotifications = 0;
  const candidates: Array<{ task: Task; spaceLabel: string; href: string }> = [];

  for (const space of spaces) {
    for (const task of space.data.tasks) {
      if (task.status === 'done') {
        if (task.completedAt?.startsWith(today)) tasksDoneToday += 1;
        continue;
      }
      tasksOpen += 1;
      if (task.status !== 'blocked') {
        candidates.push({ task, spaceLabel: space.label, href: space.href });
      }
    }
    openSuggestions += space.data.suggestions.filter((s: Suggestion) => s.status === 'open').length;
    unreadNotifications += space.data.notifications.filter((n) => !n.read).length;
  }

  candidates.sort((a, b) => {
    const p = PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority];
    if (p !== 0) return p;
    return (a.task.dueDate ?? '9999') < (b.task.dueDate ?? '9999') ? -1 : 1;
  });

  return {
    money: moneyThisMonth(spaces, now),
    energy: energyOf(latestHealth),
    tasksDoneToday,
    tasksOpen,
    openSuggestions,
    unreadNotifications,
    upgradesAwaiting: workspace.upgrades.filter((u) => u.stage === 'awaiting-approval').length,
    topPriorities: candidates.slice(0, 5),
  };
}

/** Records of one kind across every space, each tagged with where it came from. */
export function acrossSpaces<K extends keyof ScopeData>(
  spaces: readonly SpaceView[],
  collection: K,
): Array<{ item: ScopeData[K][number]; space: SpaceView }> {
  return spaces.flatMap((space) => space.data[collection].map((item) => ({ item, space })));
}
