import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { derivePageContext } from '@/lib/ui/page-context';

/**
 * The page-context guard.
 *
 * Page context colours wording and tool preference. It must never change which
 * scopes are read or which ids are written — otherwise "where the founder was
 * standing" would leak into what the assistant is allowed to see, and invariant
 * 1 would depend on a UI detail. These tests hold that line.
 */

let assistant: typeof import('@/lib/ai/assistant');
let context: typeof import('@/lib/ai/context');
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-ctx-'));
  process.env.OMNIOS_DATA_DIR = dir;
  assistant = await import('@/lib/ai/assistant');
  context = await import('@/lib/ai/context');
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('page context never touches data access', () => {
  it('loadContext reads exactly the same slices with and without a page', async () => {
    const now = new Date('2026-08-07T12:00:00.000Z');
    const page = derivePageContext('/life/health');

    const bare = await assistant.loadContext({ kind: 'founder' }, now);
    const withPage = await assistant.loadContext({ kind: 'founder', page }, now);

    expect(withPage.slices.map((s) => s.scopeKey)).toEqual(bare.slices.map((s) => s.scopeKey));
    expect(withPage.sharedMemory.length).toBe(bare.sharedMemory.length);
    // The only permitted difference is the target itself carrying the page.
    expect({ ...withPage, target: bare.target }).toEqual(bare);
  }, 60_000);

  it('targetKey — the record-id seed — is blind to the page', async () => {
    const page = derivePageContext('/companies/some-co/marketing');
    expect(context.targetKey({ kind: 'founder', page })).toBe(context.targetKey({ kind: 'founder' }));

    const scope = { kind: 'personal' as const };
    expect(context.targetKey({ kind: 'space', scope, page })).toBe(
      context.targetKey({ kind: 'space', scope }),
    );
  });
});
