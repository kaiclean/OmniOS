import 'server-only';

/**
 * Founder-level aggregation.
 *
 * This is the ONE place that reads across spaces. It exists because the founder
 * owns all of them and a unified overview is the point of the product — but it
 * is deliberately quarantined here, and it is never used to assemble context for
 * an agent. Agent context comes from `lib/ai/context.ts`, which reads a single
 * scope. If you find yourself importing this file from anywhere under `lib/ai/`,
 * something has gone wrong.
 */

import type {
  Company,
  CurrencyCode,
  PermissionGrant,
  Scope,
  Suggestion,
  Task,
  Timestamp,
  UpgradeCandidate,
} from '@/lib/domain';
import { companyScope, personalScope } from '@/lib/domain';
import { energyOf } from '@/lib/personal/energy';
import type { ScopeData } from './schema';
import { getWorkspace, readScope } from './store';

export interface SpaceView {
  readonly scope: Scope;
  readonly scopeKey: string;
  readonly id: string;
  readonly label: string;
  readonly kind: 'company' | 'personal';
  readonly href: string;
  readonly data: ScopeData;
}

/** Every space the founder owns, in rail order: companies first, then their life. */
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
  for (const space of spaces) {
    for (const entry of space.data.finance) {
      if (!entry.date.startsWith(key)) continue;
      if (entry.confidence === 'forecast') continue;
      currency = entry.amount.currency;
      if (entry.direction === 'in') inMinor += entry.amount.amount;
      else outMinor += entry.amount.amount;
    }
  }
  return { inMinor, outMinor, netMinor: inMinor - outMinor, currency };
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

/* ---------------------------------------------------------- timeline ------ */

export const TIMELINE_KINDS = [
  'action',
  'decision',
  'meeting',
  'automation',
  'assistant',
  'upgrade',
  'grant',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  action: 'Actions',
  decision: 'Decisions',
  meeting: 'Meetings',
  automation: 'Automations',
  assistant: 'Assistant',
  upgrade: 'Upgrades',
  grant: 'Grants',
};

export interface TimelineEvent {
  readonly id: string;
  readonly at: Timestamp;
  readonly kind: TimelineKind;
  readonly title: string;
  readonly detail?: string;
  readonly spaceLabel: string;
  readonly spaceKey: string;
  readonly href: string;
  readonly tone: 'ok' | 'warn' | 'pending' | 'neutral';
  readonly simulated?: boolean;
}

export interface TimelineFilter {
  readonly kinds?: readonly TimelineKind[];
  readonly spaceKey?: string;
  readonly limit?: number;
}

/**
 * The audit trail, derived — never stored.
 *
 * Every event here is a projection of a record that already exists (a ToolCall,
 * a Meeting, a run, a grant), so the timeline can never disagree with the
 * workspace and there is no second history to keep honest. Root-level events
 * (grants, upgrades) carry the space key `os`: they belong to the founder's OS,
 * not to any one space.
 */
export function buildTimeline(
  spaces: readonly SpaceView[],
  root: {
    readonly grants: readonly PermissionGrant[];
    readonly upgrades: readonly UpgradeCandidate[];
  },
  filter: TimelineFilter = {},
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const space of spaces) {
    const { scopeKey: key, label, href, data } = space;

    for (const call of data.toolCalls) {
      const pending = call.status === 'awaiting-approval';
      events.push({
        id: `call:${call.id}`,
        at: call.at,
        kind: 'action',
        title: call.preview,
        detail: pending
          ? `Waiting for your decision · ${call.risk}`
          : call.status === 'failed'
            ? (call.error ?? 'Failed.')
            : call.grantId
              ? `${call.result ?? 'Ran.'} · under a standing grant`
              : (call.result ?? call.status),
        spaceLabel: label,
        spaceKey: key,
        href: pending ? '/approvals' : href,
        tone:
          pending ? 'pending'
          : call.status === 'failed' ? 'warn'
          : call.status === 'rejected' || call.status === 'skipped' ? 'neutral'
          : 'ok',
      });
      // A per-call decision is its own moment. A grant-covered call is not: its
      // decision happened when the grant was made, and the grant events say so.
      if (call.decidedAt && call.decidedBy && !call.grantId) {
        events.push({
          id: `decision:${call.id}`,
          at: call.decidedAt,
          kind: 'decision',
          title: `${call.status === 'rejected' ? 'Rejected' : 'Approved'} — ${call.preview}`,
          detail: `Decided by ${call.decidedBy}`,
          spaceLabel: label,
          spaceKey: key,
          href: '/approvals',
          tone: call.status === 'rejected' ? 'neutral' : 'ok',
        });
      }
    }

    const roomHref = space.kind === 'company' ? `${href}/room` : '/life/room';
    for (const meeting of data.meetings) {
      events.push({
        id: `meeting:${meeting.id}`,
        at: meeting.createdAt,
        kind: 'meeting',
        title: `Meeting opened — “${meeting.topic}”`,
        detail: `${meeting.participantIds.length} specialists in the room`,
        spaceLabel: label,
        spaceKey: key,
        href: roomHref,
        tone: meeting.stage === 'plan-ready' ? 'pending' : 'neutral',
      });
      if (meeting.approvedAt && meeting.plan) {
        events.push({
          id: `meeting-approved:${meeting.id}`,
          at: meeting.approvedAt,
          kind: 'decision',
          title: `Plan approved — “${meeting.topic}”`,
          detail: `${meeting.plan.tasks.length} tasks created through the gate`,
          spaceLabel: label,
          spaceKey: key,
          href: roomHref,
          tone: 'ok',
        });
      }
      if (meeting.closedAt) {
        events.push({
          id: `meeting-closed:${meeting.id}`,
          at: meeting.closedAt,
          kind: 'meeting',
          title: `Meeting closed — “${meeting.topic}”`,
          spaceLabel: label,
          spaceKey: key,
          href: roomHref,
          tone: 'neutral',
        });
      }
    }

    for (const run of data.automationRuns) {
      const automation = data.automations.find((a) => a.id === run.automationId);
      events.push({
        id: `automation:${run.id}`,
        at: run.startedAt,
        kind: 'automation',
        title: `Automation ran — ${automation?.name ?? run.automationId}`,
        detail:
          run.status === 'awaiting-approval'
            ? 'Stopped at the gate · waiting for you'
            : run.minutesSaved > 0
              ? `${run.status} · saved ~${run.minutesSaved} min`
              : run.status,
        spaceLabel: label,
        spaceKey: key,
        href: '/automations',
        tone:
          run.status === 'success' ? 'ok'
          : run.status === 'awaiting-approval' ? 'pending'
          : 'warn',
        ...(run.simulated ? { simulated: true } : {}),
      });
    }

    for (const run of data.agentRuns) {
      events.push({
        id: `agent:${run.id}`,
        at: run.startedAt,
        kind: 'assistant',
        title: `Assistant — “${run.prompt.length > 90 ? `${run.prompt.slice(0, 90)}…` : run.prompt}”`,
        detail: `${run.plan.steps.length > 0 ? `${run.plan.steps.length} specialists · ` : ''}${run.providerId}`,
        spaceLabel: label,
        spaceKey: key,
        href: '/assistant',
        tone: 'neutral',
        ...(run.simulated ? { simulated: true } : {}),
      });
    }
  }

  for (const grant of root.grants) {
    events.push({
      id: `grant:${grant.id}`,
      at: grant.createdAt,
      kind: 'grant',
      title: `Standing grant — ${grant.note}`,
      detail: `${grant.serverId} · ${grant.toolName} · ${grant.scopeKey}`,
      spaceLabel: 'OmniOS',
      spaceKey: 'os',
      href: '/approvals',
      tone: 'ok',
    });
    if (grant.revokedAt) {
      events.push({
        id: `grant-revoked:${grant.id}`,
        at: grant.revokedAt,
        kind: 'grant',
        title: `Grant revoked — ${grant.note}`,
        detail: 'Calls under it stop immediately; the record stays',
        spaceLabel: 'OmniOS',
        spaceKey: 'os',
        href: '/approvals',
        tone: 'warn',
      });
    }
  }

  for (const upgrade of root.upgrades) {
    events.push({
      id: `upgrade:${upgrade.id}`,
      at: upgrade.createdAt,
      kind: 'upgrade',
      title: `Upgrade proposed — ${upgrade.title}`,
      detail: upgrade.whatChanged,
      spaceLabel: 'OmniOS',
      spaceKey: 'os',
      href: '/intelligence/upgrades',
      tone: upgrade.stage === 'awaiting-approval' ? 'pending' : 'neutral',
      ...(upgrade.simulated ? { simulated: true } : {}),
    });
    if (upgrade.decision) {
      events.push({
        id: `upgrade-decided:${upgrade.id}`,
        at: upgrade.decision.decidedAt,
        kind: 'decision',
        title: `Upgrade ${upgrade.decision.decision === 'approve' ? 'approved' : upgrade.decision.decision === 'reject' ? 'rejected' : 'sent back to testing'} — ${upgrade.title}`,
        detail: `Decided by ${upgrade.decision.decidedBy}`,
        spaceLabel: 'OmniOS',
        spaceKey: 'os',
        href: '/intelligence/upgrades',
        tone: upgrade.decision.decision === 'approve' ? 'ok' : 'neutral',
      });
    }
    if (upgrade.appliedAt) {
      events.push({
        id: `upgrade-applied:${upgrade.id}`,
        at: upgrade.appliedAt,
        kind: 'upgrade',
        title: `Upgrade applied — ${upgrade.title}`,
        spaceLabel: 'OmniOS',
        spaceKey: 'os',
        href: '/intelligence/upgrades',
        tone: 'ok',
      });
    }
  }

  const kinds = filter.kinds;
  const wanted = events.filter(
    (event) =>
      (!kinds || kinds.length === 0 || kinds.includes(event.kind)) &&
      (!filter.spaceKey || event.spaceKey === filter.spaceKey),
  );
  // Newest first; the id tie-break keeps the order stable when timestamps collide.
  wanted.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  return wanted.slice(0, filter.limit ?? 200);
}
