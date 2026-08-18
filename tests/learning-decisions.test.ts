import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { personalScope } from '@/lib/domain';
import type { ToolDecision } from '@/lib/learning/decisions';
import { observeDecision } from '@/lib/learning/decisions';

/**
 * Learning from gate decisions. The promises pinned here:
 *
 * - the belief is per tool and per direction, so repeats reinforce one
 *   observation instead of accumulating near-duplicates;
 * - every recorded decision leaves a `tool-approved`/`tool-rejected` entry in
 *   the evolution log, keyed by the call so it cannot be written twice;
 * - a retired belief never comes back, however often the founder keeps
 *   rejecting the same call — "stop concluding that" is a decision, not a hint.
 */

function decision(patch: Partial<ToolDecision> = {}): ToolDecision {
  return {
    scope: personalScope(),
    toolId: 'delete_record',
    toolLabel: 'Delete a record',
    capabilityId: 'operations',
    preview: 'Permanently delete record task_1 from tasks in this space.',
    decision: 'rejected',
    at: '2026-08-18T10:00:00.000Z',
    ...patch,
  };
}

describe('observeDecision', () => {
  it('derives the same id for the same tool and direction, whenever it happens', () => {
    const first = observeDecision(decision());
    const again = observeDecision(decision({ at: '2026-09-01T09:00:00.000Z', preview: 'Different call.' }));
    expect(first.id).toBe(again.id);
  });

  it('keeps approvals and rejections, and different tools, as different beliefs', () => {
    const rejected = observeDecision(decision());
    const approved = observeDecision(decision({ decision: 'approved' }));
    const otherTool = observeDecision(decision({ toolId: 'send_email' }));
    expect(new Set([rejected.id, approved.id, otherTool.id]).size).toBe(3);
  });

  it('reads as a sentence about the founder, carrying the preview as evidence', () => {
    const rejected = observeDecision(decision());
    expect(rejected.text).toBe('Rejects "Delete a record" proposals.');
    expect(rejected.kind).toBe('outcome');
    expect(rejected.source).toBe('outcome');
    expect(rejected.evidence[0]).toContain('Permanently delete record');

    const approved = observeDecision(decision({ decision: 'approved' }));
    expect(approved.text).toBe('Approves "Delete a record" when it asks first.');
  });
});

describe('a decided call teaches the scope', () => {
  let dir: string;
  let propose: typeof import('@/lib/ai/tools/propose');
  let store: typeof import('@/lib/data/store');
  let decide: typeof import('@/lib/approvals/decide');

  const scope = personalScope();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'omnios-decisions-'));
    process.env.OMNIOS_DATA_DIR = dir;
    propose = await import('@/lib/ai/tools/propose');
    store = await import('@/lib/data/store');
    decide = await import('@/lib/approvals/decide');
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.OMNIOS_DATA_DIR;
  });

  async function queueDeleteCall(recordId: string): Promise<string> {
    const outcome = await propose.proposeCore(scope, 'delete_record', {
      collection: 'tasks',
      recordId,
    });
    expect(outcome.awaitingApproval).toBe(true);
    return outcome.toolCallId;
  }

  it('a rejection becomes a belief and a tool-rejected entry in the evolution log', async () => {
    const callId = await queueDeleteCall('task_reject_1');
    expect(await decide.rejectToolCallAs(scope, callId, 'founder')).toBe(true);

    const observations = await store.readCollection(scope, 'observations');
    const belief = observations.find((entry) => entry.text === 'Rejects "Delete a record" proposals.');
    expect(belief).toBeDefined();
    expect(belief?.reinforcements).toBe(0);

    const evolution = await store.readCollection(scope, 'evolution');
    const entry = evolution.find((event) => event.kind === 'tool-rejected');
    expect(entry).toBeDefined();
    expect(entry?.autonomous).toBe(false);
    expect(entry?.summary).toContain('Rejected by you:');
  }, 60_000);

  it('rejecting the same tool again reinforces the one belief instead of duplicating it', async () => {
    const callId = await queueDeleteCall('task_reject_2');
    expect(await decide.rejectToolCallAs(scope, callId, 'founder')).toBe(true);

    const observations = await store.readCollection(scope, 'observations');
    const beliefs = observations.filter((entry) => entry.text === 'Rejects "Delete a record" proposals.');
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]?.reinforcements).toBe(1);

    const evolution = await store.readCollection(scope, 'evolution');
    expect(evolution.filter((event) => event.kind === 'tool-rejected')).toHaveLength(2);
  }, 60_000);

  it('an approval is learned even when the run itself then fails', async () => {
    const callId = await queueDeleteCall('task_that_does_not_exist');
    const outcome = await decide.approveToolCallAs(scope, callId, 'founder');
    expect(outcome.ok).toBe(false);

    const calls = await store.readCollection(scope, 'toolCalls');
    expect(calls.find((call) => call.id === callId)?.status).toBe('failed');

    const observations = await store.readCollection(scope, 'observations');
    const belief = observations.find(
      (entry) => entry.text === 'Approves "Delete a record" when it asks first.',
    );
    expect(belief).toBeDefined();

    const evolution = await store.readCollection(scope, 'evolution');
    const entry = evolution.find((event) => event.kind === 'tool-approved');
    expect(entry).toBeDefined();
    expect(entry?.autonomous).toBe(false);
  }, 60_000);

  it('a retired belief stays retired however often the same rejection recurs', async () => {
    const retiredAt = new Date().toISOString();
    await store.mutateScope(scope, (data) => ({
      ...data,
      observations: data.observations.map((entry) =>
        entry.text === 'Rejects "Delete a record" proposals.' ? { ...entry, retiredAt } : entry,
      ),
    }));

    const callId = await queueDeleteCall('task_reject_3');
    expect(await decide.rejectToolCallAs(scope, callId, 'founder')).toBe(true);

    const observations = await store.readCollection(scope, 'observations');
    const beliefs = observations.filter((entry) => entry.text === 'Rejects "Delete a record" proposals.');
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]?.retiredAt).toBe(retiredAt);
    expect(beliefs[0]?.reinforcements).toBe(1);
  }, 60_000);
});
