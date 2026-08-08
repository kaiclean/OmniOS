import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { companyScope, personalScope } from '@/lib/domain';

/**
 * The verbs a founder opens OmniOS to use.
 *
 * The registry had thirty-two tools and every one of them operated on records
 * *inside* a space — tasks, goals, KPIs, memory. None covered creating a
 * company, hiring an agent or convening the room, so asked to start a business
 * the assistant answered "there's no tool for that". It was telling the truth:
 * `createCompany` existed as a button with no vocabulary. The capability was
 * there and unreachable, which reads as an assistant that cannot do anything.
 */

let dir: string;
let propose: typeof import('@/lib/ai/tools/propose');
let store: typeof import('@/lib/data/store');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-verbs-'));
  process.env.OMNIOS_DATA_DIR = dir;
  propose = await import('@/lib/ai/tools/propose');
  store = await import('@/lib/data/store');
  await store.getWorkspace();
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('create_company', () => {
  it('builds a real company with a full headquarters', async () => {
    const result = await propose.proposeCore(personalScope(), 'create_company', {
      name: 'Reelworks',
      description: 'Short-form video for e-commerce brands.',
      industry: 'Media',
      stage: 'idea',
      goals: 'Ship a daily reel\nSign three brands',
    });
    expect(result.ok, result.summary).toBe(true);

    const workspace = await store.getWorkspace();
    const created = workspace.companies.find((company) => company.name === 'Reelworks');
    expect(created, 'the company must be on the workspace root').toBeDefined();

    // A company with no headquarters is worse than no company: the scope data is
    // written first for exactly that reason, and this is what proves it landed.
    const data = await store.readScope(companyScope(created!.id));
    expect(data.goals.length, 'a generated HQ has goals').toBeGreaterThan(0);
    expect(data.tasks.length, 'a generated HQ has work').toBeGreaterThan(0);
  }, 60_000);

  it('refuses to create the same company twice', async () => {
    const again = await propose.proposeCore(personalScope(), 'create_company', { name: 'Reelworks' });
    expect(again.ok).toBe(false);
    expect(again.summary).toMatch(/already exists/i);
  }, 60_000);
});

describe('hire_agent', () => {
  it('adds a preset to this space and only this space', async () => {
    const result = await propose.proposeCore(personalScope(), 'hire_agent', {
      presetId: 'nutrition-coach',
    });
    expect(result.ok, result.summary).toBe(true);

    const roster = await store.readCollection(personalScope(), 'customAgents');
    expect(roster.map((agent) => agent.presetId)).toContain('nutrition-coach');
    // Hiring grants nothing: the agent is a routing entry, not a permission.
    expect(roster[0]?.createdBy).toBe('assistant');
  }, 60_000);

  it('refuses a preset that does not belong in this kind of space', async () => {
    const workspace = await store.getWorkspace();
    const company = workspace.companies[0];
    const result = await propose.proposeCore(companyScope(company!.id), 'hire_agent', {
      presetId: 'nutrition-coach',
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/does not work in a company space/i);
  }, 60_000);

  it('will not hire the same agent twice', async () => {
    const again = await propose.proposeCore(personalScope(), 'hire_agent', {
      presetId: 'nutrition-coach',
    });
    expect(again.ok).toBe(false);
    expect(again.summary).toMatch(/already on this roster/i);
  }, 60_000);
});

describe('open_meeting', () => {
  it('seats the specialists the topic needs', async () => {
    const result = await propose.proposeCore(personalScope(), 'open_meeting', {
      topic: 'How do I stop losing evenings to admin?',
    });
    expect(result.ok, result.summary).toBe(true);

    const meetings = await store.readCollection(personalScope(), 'meetings');
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.participantIds.length).toBeGreaterThan(0);
    expect(meetings[0]?.stage).toBe('in-session');
  }, 60_000);
});
