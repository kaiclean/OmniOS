/**
 * The cross-space activity timeline. Part of the cross-space quarantine: nothing
 * under `lib/ai/` may import this (see `tests/boundaries.test.ts`).
 */

import type { PermissionGrant, Timestamp, UpgradeCandidate } from '@/lib/domain';
import type { SpaceView } from './types';

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
  /**
   * A call that only looked at something. The full timeline keeps these — an
   * audit trail that hides reads is not an audit trail — but a digest view may
   * fold them away so one lookup-heavy turn cannot drown the day's changes.
   */
  readonly readOnly?: boolean;
}

export interface TimelineFilter {
  readonly kinds?: readonly TimelineKind[];
  readonly spaceKey?: string;
  readonly limit?: number;
  /**
   * Fold read-only calls away *before* the limit is applied — a digest that
   * filtered after limiting could be emptied entirely by one lookup-heavy
   * stretch, hiding the very writes it exists to surface.
   */
  readonly excludeReadOnly?: boolean;
  /** Only events strictly older than this instant — how the trail pages back. */
  readonly before?: Timestamp;
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
        ...(call.risk === 'read' ? { readOnly: true } : {}),
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
        // Only tasks that actually got a record count as created — a task the
        // gate held has no id yet and saying otherwise would be the timeline
        // inventing history.
        const materialised = meeting.plan.tasks.filter((task) => task.taskId).length;
        events.push({
          id: `meeting-approved:${meeting.id}`,
          at: meeting.approvedAt,
          kind: 'decision',
          title: `Plan approved — “${meeting.topic}”`,
          detail:
            materialised === meeting.plan.tasks.length
              ? `${materialised} tasks created through the gate`
              : `${materialised} of ${meeting.plan.tasks.length} tasks created — the rest wait at the gate`,
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
      (!filter.spaceKey || event.spaceKey === filter.spaceKey) &&
      (!filter.excludeReadOnly || !event.readOnly) &&
      (!filter.before || event.at < filter.before),
  );
  // Newest first; the id tie-break keeps the order stable when timestamps collide.
  wanted.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  return wanted.slice(0, filter.limit ?? 200);
}
