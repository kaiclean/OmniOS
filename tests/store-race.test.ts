import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { personalScope } from '@/lib/domain';

/**
 * The persistence layer's serialisation guarantee.
 *
 * A filesystem store on one process still faces concurrency: the UI, the
 * Telegram webhook and the heartbeat all issue Server Actions that read, modify
 * and write the same file, and Node interleaves their awaits freely. If the
 * read is outside the write queue, two callers read one snapshot and the second
 * write discards the first — a silently lost record, or a resurrected grant.
 * These tests fire the racing writers concurrently and assert nothing is lost.
 */

let dir: string;
let store: typeof import('@/lib/data/store');
let decide: typeof import('@/lib/approvals/decide');
let propose: typeof import('@/lib/ai/tools/propose');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-race-'));
  process.env.OMNIOS_DATA_DIR = dir;
  store = await import('@/lib/data/store');
  decide = await import('@/lib/approvals/decide');
  propose = await import('@/lib/ai/tools/propose');
  await store.getWorkspace();
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('concurrent scope writers do not clobber each other', () => {
  it('keeps every record when 20 inserts race into one scope', async () => {
    const scope = personalScope();
    const before = (await store.readCollection(scope, 'tasks')).length;
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.insertRecords(scope, 'tasks', [
          {
            id: `race_task_${i}`,
            scope,
            createdAt: '2026-08-07T00:00:00.000Z',
            updatedAt: '2026-08-07T00:00:00.000Z',
            title: `Race ${i}`,
            status: 'todo',
            priority: 'p2',
            capabilityId: 'operations',
          },
        ] as never),
      ),
    );
    const after = await store.readCollection(scope, 'tasks');
    expect(after.length).toBe(before + 20);
    for (let i = 0; i < 20; i += 1) {
      expect(after.some((t) => (t as { id: string }).id === `race_task_${i}`)).toBe(true);
    }
  }, 60_000);
});

describe('concurrent root writers do not resurrect a revoked grant', () => {
  it('a heartbeat racing a revoke leaves the grant revoked and the beat recorded', async () => {
    await store.saveWorkspace((root) => ({
      ...root,
      grants: [
        {
          id: 'grant_race',
          serverId: 'srv',
          toolName: 'search',
          scopeKey: 'personal',
          note: 'race grant',
          createdAt: '2026-08-07T00:00:00.000Z',
        },
      ],
    }));

    // Revoke and record-a-beat, issued together. Read-modify-write must be
    // serialised or the beat write overwrites the revocation (or vice versa).
    const beatAt = '2026-08-07T12:00:00.000Z';
    await Promise.all([
      store.saveWorkspace((root) => ({
        ...root,
        grants: root.grants.map((g) => (g.id === 'grant_race' ? { ...g, revokedAt: beatAt } : g)),
      })),
      store.saveWorkspace((root) => ({ ...root, lastHeartbeatAt: beatAt })),
    ]);

    const root = await store.getWorkspace();
    expect(root.grants.find((g) => g.id === 'grant_race')?.revokedAt).toBe(beatAt);
    expect(root.lastHeartbeatAt).toBe(beatAt);
  }, 60_000);
});

describe('a pending call is decided exactly once', () => {
  it('two concurrent approvals do not both run the tool', async () => {
    const scope = personalScope();
    // publish_post is external → queues awaiting-approval.
    const proposed = await propose.proposeCore(scope, 'publish_post', { channel: 'blog', body: 'hi' });
    expect(proposed.awaitingApproval).toBe(true);

    const [a, b] = await Promise.all([
      decide.approveToolCallAs(scope, proposed.toolCallId, 'founder'),
      decide.approveToolCallAs(scope, proposed.toolCallId, 'founder'),
    ]);
    // Exactly one claim wins; the other reports the call was already decided.
    const winners = [a, b].filter((o) => o.error !== 'not-pending');
    expect(winners).toHaveLength(1);
  }, 60_000);

  it('a reject racing an approve reports the truth, never "nothing ran" over a run', async () => {
    const scope = personalScope();
    const proposed = await propose.proposeCore(scope, 'publish_post', { channel: 'blog', body: 'yo' });
    const [approved, rejected] = await Promise.all([
      decide.approveToolCallAs(scope, proposed.toolCallId, 'founder'),
      decide.rejectToolCallAs(scope, proposed.toolCallId, 'founder'),
    ]);
    // The reject only claims success if it was the one that moved the call.
    const approvedWon = approved.error !== 'not-pending';
    expect(approvedWon === !rejected).toBe(true);
  }, 60_000);
});
