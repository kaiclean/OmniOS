import { describe, expect, it } from 'vitest';

import type { SpaceView } from '@/lib/data/aggregate';
import { buildTimeline } from '@/lib/data/aggregate';
import { emptyScopeData } from '@/lib/data/schema';
import type { Meeting, PermissionGrant, ToolCall } from '@/lib/domain';
import { companyScope } from '@/lib/domain';

const scope = companyScope('acme');

function space(patch: Partial<SpaceView['data']>): SpaceView {
  return {
    scope,
    scopeKey: 'company:acme',
    id: 'acme',
    label: 'Acme',
    kind: 'company',
    href: '/companies/acme',
    data: { ...emptyScopeData(), ...patch },
  };
}

function call(patch: Partial<ToolCall>): ToolCall {
  return {
    id: 'call-1',
    scope,
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
    toolId: 'create_task',
    args: {},
    status: 'executed',
    risk: 'write',
    preview: 'Create the task “Ship it”.',
    affectedIds: [],
    at: '2026-08-07T10:00:00.000Z',
    ...patch,
  };
}

const NO_ROOT = { grants: [], upgrades: [] };

describe('the timeline', () => {
  it('turns a pending call into a pending event that leads to the approvals inbox', () => {
    const events = buildTimeline([space({ toolCalls: [call({ status: 'awaiting-approval' })] })], NO_ROOT);
    expect(events).toHaveLength(1);
    expect(events[0]!.tone).toBe('pending');
    expect(events[0]!.href).toBe('/approvals');
    expect(events[0]!.title).toBe('Create the task “Ship it”.');
  });

  it('gives a per-call decision its own moment, but never a grant-covered call', () => {
    const decided = call({
      id: 'call-2',
      status: 'executed',
      decidedAt: '2026-08-07T11:00:00.000Z',
      decidedBy: 'telegram:1:user:2',
    });
    const granted = call({
      id: 'call-3',
      status: 'executed',
      decidedAt: '2026-08-01T09:00:00.000Z',
      decidedBy: 'founder',
      grantId: 'grant-1',
    });
    const events = buildTimeline([space({ toolCalls: [decided, granted] })], NO_ROOT);

    const decisions = events.filter((event) => event.kind === 'decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.detail).toBe('Decided by telegram:1:user:2');
    // The grant-covered call still shows, and says how it was allowed to run.
    const grantedEvent = events.find((event) => event.id === 'call:call-3');
    expect(grantedEvent?.detail).toContain('standing grant');
  });

  it('walks a meeting through opened, approved and closed as separate events', () => {
    const meeting: Meeting = {
      id: 'meet-1',
      scope,
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T09:40:00.000Z',
      topic: 'Ship faster',
      stage: 'closed',
      participantIds: ['chief-of-staff', 'engineer'],
      turns: [],
      plan: { summary: 's', decisions: [], tasks: [{ title: 't', capabilityId: 'projects', ownerSpecialistId: 'engineer' }], risks: [], simulated: false },
      approvedAt: '2026-08-07T09:30:00.000Z',
      closedAt: '2026-08-07T09:40:00.000Z',
    };
    const events = buildTimeline([space({ meetings: [meeting] })], NO_ROOT);
    expect(events.map((event) => event.id)).toEqual([
      'meeting-closed:meet-1',
      'meeting-approved:meet-1',
      'meeting:meet-1',
    ]);
    expect(events[1]!.detail).toBe('1 tasks created through the gate');
    expect(events[1]!.href).toBe('/companies/acme/room');
  });

  it('records a grant and its revocation as two events with opposite weights', () => {
    const grant: PermissionGrant = {
      id: 'grant-1',
      serverId: 'github',
      toolName: 'create_issue',
      scopeKey: 'company:acme',
      note: 'Weekly triage',
      createdAt: '2026-08-01T09:00:00.000Z',
      revokedAt: '2026-08-05T09:00:00.000Z',
    };
    const events = buildTimeline([], { grants: [grant], upgrades: [] });
    expect(events).toHaveLength(2);
    expect(events[0]!.title).toContain('revoked');
    expect(events[0]!.tone).toBe('warn');
    expect(events[1]!.tone).toBe('ok');
    expect(events.every((event) => event.spaceKey === 'os')).toBe(true);
  });

  it('filters by kind and by space, and sorts newest first', () => {
    const other: SpaceView = {
      ...space({}),
      scopeKey: 'personal',
      id: 'personal',
      label: 'Life',
      kind: 'personal',
      href: '/life',
      data: { ...emptyScopeData(), toolCalls: [call({ id: 'call-p', at: '2026-08-07T12:00:00.000Z' })] },
    };
    const spaces = [space({ toolCalls: [call({})] }), other];

    const all = buildTimeline(spaces, NO_ROOT);
    expect(all.map((event) => event.id)).toEqual(['call:call-p', 'call:call-1']);

    const onlyPersonal = buildTimeline(spaces, NO_ROOT, { spaceKey: 'personal' });
    expect(onlyPersonal).toHaveLength(1);
    expect(onlyPersonal[0]!.spaceLabel).toBe('Life');

    expect(buildTimeline(spaces, NO_ROOT, { kinds: ['meeting'] })).toHaveLength(0);
    expect(buildTimeline(spaces, NO_ROOT, { limit: 1 })).toHaveLength(1);
  });
});
