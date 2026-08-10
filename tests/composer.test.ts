import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LlmProvider, LlmToolResponse } from '@/lib/domain';
import { personalScope } from '@/lib/domain';

/**
 * The composer's three verbs — /command, @mention, and named threads — plus
 * the structural narrowing of a hired agent's loop. All exercised against a
 * real temp store, because every one of them ends in records.
 */

const NOW = new Date('2026-08-08T09:00:00.000Z');

let dir: string;
let assistant: typeof import('@/lib/ai/assistant');
let loop: typeof import('@/lib/ai/loop');
let store: typeof import('@/lib/data/store');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-composer-'));
  process.env.OMNIOS_DATA_DIR = dir;
  assistant = await import('@/lib/ai/assistant');
  loop = await import('@/lib/ai/loop');
  store = await import('@/lib/data/store');
  await store.getWorkspace();
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('slash commands are the deterministic fast path', () => {
  it('/task creates exactly one task through the gate, no model involved', async () => {
    const result = await assistant.ask(
      { kind: 'space', scope: personalScope() },
      '/task Buy the omnios.ch domain',
      NOW,
    );
    expect(result.message.text).toContain('Done:');

    const tasks = await store.readCollection(personalScope(), 'tasks');
    expect(tasks.some((task) => task.title === 'Buy the omnios.ch domain')).toBe(true);
  }, 60_000);

  it('a /command in founder mode says where to stand, rather than guessing a space', async () => {
    const result = await assistant.ask({ kind: 'founder' }, '/task Somewhere unclear', NOW);
    expect(result.message.text).toContain('open a company or your life first');
    const tasks = await store.readCollection(personalScope(), 'tasks');
    expect(tasks.some((task) => task.title === 'Somewhere unclear')).toBe(false);
  }, 60_000);

  it('an unknown /command is left as ordinary text, never guessed at', async () => {
    const result = await assistant.ask({ kind: 'founder' }, '/frobnicate everything', NOW);
    expect(result.message.text).not.toContain('Done:');
  }, 60_000);
});

describe('mentions choose the voice without granting anything', () => {
  it('@engineer makes the engineer the lead', async () => {
    const result = await assistant.ask({ kind: 'founder' }, '@engineer how risky is the migration?', NOW);
    expect(result.plan.steps[0]?.specialistId).toBe('engineer');
  }, 60_000);

  it('an unknown @name stays in the text and routing proceeds normally', async () => {
    const result = await assistant.ask({ kind: 'founder' }, '@nobody-real what should I do today?', NOW);
    expect(result.plan.steps.length).toBeGreaterThan(0);
    expect(result.plan.steps[0]?.specialistId).not.toBe('nobody-real');
  }, 60_000);
});

describe('named threads are derived from the messages themselves', () => {
  it('a channelled ask lands in its thread and nowhere else', async () => {
    const channel = 'thread:test00000001';
    await assistant.ask({ kind: 'founder' }, 'What matters most this week?', NOW, { channel });

    const thread = await assistant.conversation({ kind: 'founder' }, channel);
    expect(thread.length).toBe(2);
    expect(thread.every((message) => message.channel === channel)).toBe(true);

    // The main thread never shows channelled messages.
    const main = await assistant.conversation({ kind: 'founder' });
    expect(main.some((message) => message.channel === channel)).toBe(false);

    const threads = await assistant.listThreads({ kind: 'founder' });
    const summary = threads.find((entry) => entry.channel === channel);
    expect(summary?.title).toContain('What matters most');
    expect(summary?.count).toBe(2);
  }, 60_000);
});

describe('a hired agent’s loop is structurally narrowed', () => {
  it('a tool outside the filter is never offered, so a model naming it is dropped', async () => {
    const provider: LlmProvider = {
      id: 'scripted',
      label: 'Scripted',
      simulated: false,
      keyName: null,
      available: async () => true,
      complete: async () => ({ text: '', providerId: 'scripted', simulated: false }),
      completeWithTools: async (): Promise<LlmToolResponse> =>
        ({
          text: '',
          calls: [{ name: 'add_finance_entry', args: { label: 'Sneaky invoice', amount: 500, direction: 'out' } }],
          simulated: false,
          providerId: 'scripted',
        }) as unknown as LlmToolResponse,
    };

    const result = await loop.runActLoop('log an invoice for 500', {
      scope: personalScope(),
      provider,
      now: NOW,
      agent: { capabilityIds: ['health'] },
    });

    // The call was dropped by name resolution, not executed and not queued.
    expect(result.steps).toHaveLength(0);
    const finance = await store.readCollection(personalScope(), 'finance');
    expect(finance.some((entry) => entry.label === 'Sneaky invoice')).toBe(false);
  }, 60_000);
});
