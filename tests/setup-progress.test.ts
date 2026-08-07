import { describe, expect, it } from 'vitest';

import type { SpaceView } from '@/lib/data/aggregate';
import { buildTimeline, setupProgress } from '@/lib/data/aggregate';
import { emptyScopeData } from '@/lib/data/schema';
import type { Company, ToolCall } from '@/lib/domain';
import { DEFAULT_TELEGRAM_CONFIG, companyScope } from '@/lib/domain';

const scope = companyScope('acme');

function space(patch: Partial<SpaceView['data']> = {}): SpaceView {
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
    toolId: 'search_workspace',
    args: {},
    status: 'executed',
    risk: 'read',
    preview: 'Search this space.',
    affectedIds: [],
    at: '2026-08-07T10:00:00.000Z',
    ...patch,
  };
}

const company = (patch: Partial<Company>) => ({ id: 'acme', name: 'Acme', ...patch }) as Company;

const EMPTY_ROOT = {
  companies: [],
  telegram: DEFAULT_TELEGRAM_CONFIG,
  mcpStates: [],
  grants: [],
};

describe('zero to hero is derived, never stored', () => {
  it('starts at zero on a fresh simulated workspace', () => {
    const progress = setupProgress([space()], EMPTY_ROOT, { hasRealProvider: false });
    expect(progress.done).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it('counts only what the records actually show', () => {
    const progress = setupProgress(
      [space({ meetings: [{ id: 'm' } as never], toolCalls: [call({ decidedBy: 'founder' })] })],
      { ...EMPTY_ROOT, companies: [company({ generated: true })] },
      { hasRealProvider: true },
    );
    const byId = Object.fromEntries(progress.steps.map((step) => [step.id, step.done]));
    expect(byId['brain']).toBe(true);
    // A generated sample company is not the founder's first company.
    expect(byId['company']).toBe(false);
    expect(byId['meeting']).toBe(true);
    expect(byId['decision']).toBe(true);
    expect(byId['telegram']).toBe(false);
  });

  it('an undecided queue is not a decision', () => {
    const progress = setupProgress(
      [space({ toolCalls: [call({ status: 'awaiting-approval' })] })],
      EMPTY_ROOT,
      { hasRealProvider: false },
    );
    expect(progress.steps.find((step) => step.id === 'decision')?.done).toBe(false);
  });
});

describe('the digest can fold reads away without the timeline losing them', () => {
  it('marks read-tier actions and keeps them in the full trail', () => {
    const events = buildTimeline(
      [space({ toolCalls: [call({}), call({ id: 'call-2', toolId: 'create_task', risk: 'write', preview: 'Create a task.' })] })],
      { grants: [], upgrades: [] },
    );
    expect(events).toHaveLength(2);
    const read = events.find((event) => event.id === 'call:call-1');
    const write = events.find((event) => event.id === 'call:call-2');
    expect(read?.readOnly).toBe(true);
    expect(write?.readOnly).toBeUndefined();
  });

  it('excludes reads before the limit, so a lookup-heavy stretch cannot empty the digest', () => {
    const reads = Array.from({ length: 5 }, (_, i) =>
      call({ id: `read-${i}`, at: `2026-08-07T12:0${i}:00.000Z` }),
    );
    const write = call({
      id: 'the-write',
      toolId: 'create_task',
      risk: 'write',
      preview: 'Create a task.',
      at: '2026-08-07T09:00:00.000Z',
    });
    const events = buildTimeline([space({ toolCalls: [...reads, write] })], { grants: [], upgrades: [] }, {
      limit: 2,
      excludeReadOnly: true,
    });
    // The older write survives even though five newer reads fill the raw window.
    expect(events.map((event) => event.id)).toEqual(['call:the-write']);
  });
});

describe('an off-switch is not a hire', () => {
  it('the agent step completes on a real hire, never on switching a built-in off', () => {
    const offSwitch = {
      id: 'engineer', overridesBuiltIn: true, offSwitch: true, enabled: false,
    } as never;
    const hire = { id: 'podcast-producer', overridesBuiltIn: false, enabled: true } as never;

    const withOffSwitch = setupProgress([space({ customAgents: [offSwitch] })], EMPTY_ROOT, { hasRealProvider: false });
    expect(withOffSwitch.steps.find((step) => step.id === 'agent')?.done).toBe(false);

    const withHire = setupProgress([space({ customAgents: [hire] })], EMPTY_ROOT, { hasRealProvider: false });
    expect(withHire.steps.find((step) => step.id === 'agent')?.done).toBe(true);
  });
});

describe('a plan approval only claims the tasks that exist', () => {
  it('says so plainly when the gate held some of them', () => {
    const meeting = {
      id: 'meet-1',
      scope,
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T09:30:00.000Z',
      topic: 'Ship',
      stage: 'executing',
      participantIds: ['engineer'],
      turns: [],
      plan: {
        summary: 's',
        decisions: [],
        risks: [],
        simulated: false,
        tasks: [
          { title: 'a', capabilityId: 'operations', ownerSpecialistId: 'engineer', taskId: 'task-a' },
          { title: 'b', capabilityId: 'operations', ownerSpecialistId: 'engineer' },
        ],
      },
      approvedAt: '2026-08-07T09:30:00.000Z',
    } as never;
    const events = buildTimeline([space({ meetings: [meeting] })], { grants: [], upgrades: [] });
    const approved = events.find((event) => event.id === 'meeting-approved:meet-1');
    expect(approved?.detail).toBe('1 of 2 tasks created — the rest wait at the gate');
  });
});
