import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PermissionGrant } from '@/lib/domain';
import { grantCovers, personalScope } from '@/lib/domain';

/**
 * The grant layer's promises, pinned. A grant is exact, expiring, revocable —
 * and can never reach a built-in destructive tool. If any assertion here has
 * to change, that is a security design change, not a refactor.
 */

const NOW = new Date('2026-08-07T12:00:00.000Z');

function grant(patch: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    id: 'grant_test',
    serverId: 'test-bench',
    toolName: 'search_web',
    scopeKey: 'personal',
    note: 'test grant',
    createdAt: '2026-08-07T00:00:00.000Z',
    ...patch,
  };
}

describe('what a grant covers', () => {
  const call = { serverId: 'test-bench', toolName: 'search_web', scopeKey: 'personal' };

  it('covers only the exact triple it names', () => {
    expect(grantCovers(grant(), call, NOW)).toBe(true);
    expect(grantCovers(grant(), { ...call, serverId: 'other' }, NOW)).toBe(false);
    expect(grantCovers(grant(), { ...call, toolName: 'publish_post' }, NOW)).toBe(false);
    expect(grantCovers(grant(), { ...call, scopeKey: 'company:x' }, NOW)).toBe(false);
  });

  it('honours the explicit wildcards, and only those', () => {
    expect(grantCovers(grant({ toolName: '*' }), { ...call, toolName: 'anything' }, NOW)).toBe(true);
    expect(grantCovers(grant({ scopeKey: '*' }), { ...call, scopeKey: 'company:x' }, NOW)).toBe(true);
    // There is deliberately no server wildcard: trust is per connection.
    expect(grantCovers(grant({ serverId: 'test-bench' }), { ...call, serverId: 'any' }, NOW)).toBe(false);
  });

  it('dies at its expiry and at revocation', () => {
    expect(grantCovers(grant({ expiresAt: '2026-08-07T11:59:59.000Z' }), call, NOW)).toBe(false);
    expect(grantCovers(grant({ expiresAt: '2026-08-07T12:00:01.000Z' }), call, NOW)).toBe(true);
    expect(grantCovers(grant({ revokedAt: '2026-08-07T01:00:00.000Z' }), call, NOW)).toBe(false);
  });
});

describe('the gate with grants', () => {
  let dir: string;
  let propose: typeof import('@/lib/ai/tools/propose');
  let store: typeof import('@/lib/data/store');

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'omnios-grants-'));
    process.env.OMNIOS_DATA_DIR = dir;
    propose = await import('@/lib/ai/tools/propose');
    store = await import('@/lib/data/store');
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.OMNIOS_DATA_DIR;
  });

  it('a built-in destructive call queues even when a wildcard-happy grant exists', async () => {
    await store.saveWorkspace((current) => ({
      ...current,
      grants: [
        grant({ id: 'grant_wild', serverId: 'test-bench', toolName: '*', scopeKey: '*' }),
      ],
    }));

    // delete_record is destructive and built-in — no grant may ever cover it.
    const outcome = await propose.proposeCore(personalScope(), 'delete_record', {
      collection: 'tasks',
      recordId: 'task_nonexistent',
    });
    expect(outcome.awaitingApproval).toBe(true);

    const calls = await store.readCollection(personalScope(), 'toolCalls');
    const call = calls.find((candidate) => candidate.id === outcome.toolCallId);
    expect(call?.status).toBe('awaiting-approval');
    expect(call?.grantId).toBeUndefined();
  }, 60_000);

  it('an ungranted external call still queues', async () => {
    await store.saveWorkspace((current) => ({ ...current, grants: [] }));
    const outcome = await propose.proposeCore(personalScope(), 'publish_post', {
      channel: 'blog',
      body: 'hello',
    });
    expect(outcome.awaitingApproval).toBe(true);
  }, 60_000);

  it('a call carrying a vault secret reference queues, whatever tier the tool sits at', async () => {
    await store.saveWorkspace((current) => ({ ...current, grants: [] }));
    // write_doc is a `write` tool — normally autonomous. A {{secret:X}} in any
    // argument forces the gate: plaintext must never leave without a decision.
    const outcome = await propose.proposeCore(personalScope(), 'write_doc', {
      title: 'Onboarding',
      body: 'The key is {{secret:STRIPE_KEY}} — do not lose it.',
    });
    expect(outcome.awaitingApproval).toBe(true);

    const calls = await store.readCollection(personalScope(), 'toolCalls');
    const call = calls.find((candidate) => candidate.id === outcome.toolCallId);
    expect(call?.status).toBe('awaiting-approval');
    // The placeholder is what is stored — never the resolved plaintext.
    expect(JSON.stringify(call?.args)).toContain('{{secret:STRIPE_KEY}}');
  }, 60_000);
});
