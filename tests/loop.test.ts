import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LlmProvider, LlmToolResponse } from '@/lib/domain';
import { personalScope } from '@/lib/domain';

/**
 * The acting loop.
 *
 * A loop that can act repeatedly is exactly the shape that could route around
 * the approval gate, so these tests are written against that possibility rather
 * than against the happy path. The load-bearing one is the third: a gated call
 * must *stop* the loop, because continuing would mean planning the next step on
 * the assumption the founder is going to say yes.
 */

const NOW = new Date('2026-08-07T09:00:00.000Z');

let dir: string;
let loop: typeof import('@/lib/ai/loop');
let store: typeof import('@/lib/data/store');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-loop-'));
  process.env.OMNIOS_DATA_DIR = dir;
  loop = await import('@/lib/ai/loop');
  store = await import('@/lib/data/store');
  await store.getWorkspace();
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

/** A provider that plans a fixed script, one round at a time. */
function scripted(rounds: ReadonlyArray<ReadonlyArray<{ name: string; args: Record<string, unknown> }>>) {
  let round = 0;
  const seen: string[] = [];
  const provider: LlmProvider = {
    id: 'scripted',
    label: 'Scripted',
    simulated: false,
    keyName: null,
    available: async () => true,
    complete: async () => ({ text: '', providerId: 'scripted', simulated: false }),
    completeWithTools: async (request): Promise<LlmToolResponse> => {
      seen.push(request.messages.find((m) => m.role === 'user')?.content ?? '');
      const calls = rounds[round] ?? [];
      round += 1;
      return { text: '', calls: [...calls], simulated: false, providerId: 'scripted' } as unknown as LlmToolResponse;
    },
  };
  return { provider, seen, rounds: () => round };
}

describe('the loop can find something out and then use it', () => {
  it('feeds a tool result back into the next round of planning', async () => {
    const { provider, seen } = scripted([
      [{ name: 'search_workspace', args: { query: 'auditor' } }],
      [{ name: 'create_task', args: { title: 'Follow up with the auditor' } }],
      [],
    ]);

    const result = await loop.runActLoop('is the auditor tracked, and if not add it', {
      scope: personalScope(),
      provider,
      now: NOW,
    });

    expect(result.steps.map((s) => s.toolId)).toEqual(['search_workspace', 'create_task']);
    // The second round must have been able to see what the first returned —
    // otherwise the loop is just three unrelated single-shot turns.
    expect(seen[1]).toContain('What you have already done this turn');
    expect(seen[1]).toContain('search_workspace');
    // And the founder's own words survive every round rather than being summarised.
    expect(seen[1]).toContain('is the auditor tracked');
  }, 30_000);

  it('stops as soon as the planner has nothing left to do', async () => {
    const { provider, rounds } = scripted([[{ name: 'search_workspace', args: { query: 'nothing' } }], []]);
    await loop.runActLoop('look something up', { scope: personalScope(), provider, now: NOW });
    // Two planning calls, not four: an empty plan ends the turn.
    expect(rounds()).toBe(2);
  }, 30_000);
});

describe('the loop cannot outrun the gate', () => {
  it('halts on a gated call instead of planning past it', async () => {
    const { provider, rounds } = scripted([
      [{ name: 'send_email', args: { to: 'x@example.com', subject: 'Hi', body: 'Hello.' } }],
      [{ name: 'create_task', args: { title: 'Should never be reached' } }],
    ]);

    const result = await loop.runActLoop('email them and then note it', {
      scope: personalScope(),
      provider,
      now: NOW,
    });

    expect(result.haltedBecause).toBe('awaiting-approval');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.awaitingApproval).toBe(true);
    // The planner was never asked for a second round. Continuing would have meant
    // assuming the founder says yes, which is the decision the gate reserves.
    expect(rounds()).toBe(1);

    const tasks = await store.readCollection(personalScope(), 'tasks');
    expect(tasks.some((task) => task.title === 'Should never be reached')).toBe(false);
  }, 30_000);

  it('says out loud that it stopped, and why', async () => {
    const result = await loop.runActLoop('send the update', {
      scope: personalScope(),
      provider: scripted([[{ name: 'send_email', args: { to: 'a@example.com', subject: 'Update', body: 'Hello.' } }]]).provider,
      now: new Date('2026-08-07T12:00:00.000Z'),
    });
    expect(loop.describeLoop(result).join(' ')).toContain('I stopped there');
  }, 30_000);

  it('refuses to queue a delete whose target does not exist, before the gate ever sees it', async () => {
    const result = await loop.runActLoop('delete something', {
      scope: personalScope(),
      provider: scripted([[{ name: 'delete_record', args: { collection: 'tasks', recordId: 'nope' } }]]).provider,
      now: NOW,
    });
    // Queuing it would invite the founder to approve a deletion that must fail.
    expect(result.steps).toHaveLength(0);
    expect(result.haltedBecause).toBeUndefined();
    expect(result.note).toMatch(/could not find/i);
  }, 30_000);
});

describe('the loop is bounded', () => {
  it('gives up after a fixed number of rounds rather than running unattended', async () => {
    // A planner that never says "done" is the failure mode that costs money and
    // fills a workspace, so the ceiling is structural rather than advisory.
    const forever = scripted(
      Array.from({ length: 20 }, (_, i) => [{ name: 'create_task', args: { title: `Loop task ${i}` } }]),
    );

    const result = await loop.runActLoop('keep going', {
      scope: personalScope(),
      provider: forever.provider,
      now: NOW,
    });

    expect(result.haltedBecause).toBe('round-limit');
    expect(result.steps.length).toBeLessThanOrEqual(8);
    expect(loop.describeLoop(result).join(' ')).toContain('rather than keep going unattended');
  }, 60_000);
});

describe('a turn never writes the same record twice', () => {
  /**
   * The loop freezes `now` for a whole turn — it must, or a generator would read
   * the clock — and a ToolCall id is derived from scope, tool, timestamp and
   * args. So a model repeating an identical call across two rounds produced two
   * records with the SAME id, and `insertRecords` prepended the duplicate. It
   * surfaced as React refusing to render the approvals list: "two children with
   * the same key". Seen for real with an identical `search_workspace` in rounds
   * two and four, and lost once already to a merge — hence the test.
   */
  it('writes two distinct records when the model repeats itself', async () => {
    const repeat = { name: 'search_workspace', args: { query: 'rothbau', collection: 'docs' } };
    const { provider } = scripted([[repeat], [repeat], []]);

    const before = (await store.readCollection(personalScope(), 'toolCalls')).length;
    const result = await loop.runActLoop('look for rothbau twice', {
      scope: personalScope(),
      provider,
      now: NOW,
    });

    expect(result.steps).toHaveLength(2);
    const after = await store.readCollection(personalScope(), 'toolCalls');
    expect(after.length - before).toBe(2);

    const ids = after.slice(0, 2).map((call) => call.id);
    expect(new Set(ids).size, `both steps must have their own id, got ${ids.join(' and ')}`).toBe(2);
  }, 30_000);
});

describe('deleting by name, which is the only way a founder ever says it', () => {
  const local: LlmProvider = {
    id: 'local-only',
    label: 'Local',
    simulated: true,
    keyName: null,
    available: async () => true,
    complete: async () => ({ text: '', providerId: 'local-only', simulated: true }),
  };
  const AT_TEN = new Date('2026-08-07T10:00:00.000Z');
  const AT_ELEVEN = new Date('2026-08-07T11:00:00.000Z');

  it('resolves a quoted title to the real record id and stops at the gate', async () => {
    const { provider } = scripted([
      [{ name: 'create_task', args: { title: 'Ship the Nordwind deck' } }],
      [],
    ]);
    await loop.runActLoop('create the deck task', { scope: personalScope(), provider, now: AT_TEN });
    const tasks = await store.readCollection(personalScope(), 'tasks');
    const created = tasks.find((task) => task.title === 'Ship the Nordwind deck');
    expect(created).toBeDefined();

    const result = await loop.runActLoop('delete the task "Ship the Nordwind deck"', {
      scope: personalScope(),
      provider: local,
      now: AT_TEN,
    });
    expect(result.intent).toBe('command');
    expect(result.haltedBecause).toBe('awaiting-approval');
    expect(result.steps[0]!.toolId).toBe('delete_record');
    expect(result.steps[0]!.awaitingApproval).toBe(true);
    // The preview names the real record, not the words the founder used as an id.
    expect(result.steps[0]!.summary).toContain(created!.id);
  }, 30_000);

  it('refuses an ambiguous name and lists the candidates instead of guessing', async () => {
    const { provider } = scripted([
      [
        { name: 'create_task', args: { title: 'Alpha report' } },
        { name: 'create_task', args: { title: 'Alpha report v2' } },
      ],
      [],
    ]);
    await loop.runActLoop('create the alpha tasks', { scope: personalScope(), provider, now: AT_ELEVEN });

    const result = await loop.runActLoop('delete the task "Alpha"', {
      scope: personalScope(),
      provider: local,
      now: AT_ELEVEN,
    });
    expect(result.steps).toHaveLength(0);
    expect(result.note).toMatch(/matches 2 records/);
    expect(result.note).toMatch(/Nothing was deleted/);
    const tasks = await store.readCollection(personalScope(), 'tasks');
    expect(tasks.filter((task) => task.title.startsWith('Alpha report'))).toHaveLength(2);
  }, 30_000);
});
