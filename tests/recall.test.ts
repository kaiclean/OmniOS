import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cosineSimilarity } from '@/lib/ai/embeddings';
import { personalScope } from '@/lib/domain';

/**
 * Retrieval.
 *
 * `MemoryQuery` was declared when memory shipped and never implemented — memory
 * reached the assistant as whatever `loadContext` happened to load, unranked.
 * These pin the ranking, and pin that it degrades honestly: on a workspace with
 * no embedding-capable key the same function still returns the right records by
 * lexical overlap, and says which signal it used rather than implying semantics.
 */

const NOW = new Date('2026-08-07T09:00:00.000Z');

let dir: string;
let recall: typeof import('@/lib/ai/recall');
let store: typeof import('@/lib/data/store');

const memory = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  scope: personalScope(),
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  kind: 'preference' as const,
  text,
  capabilityId: 'executive',
  strength: 0.8,
  tags: [],
  source: 'founder' as const,
  useCount: 0,
  ...extra,
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-recall-'));
  process.env.OMNIOS_DATA_DIR = dir;
  recall = await import('@/lib/ai/recall');
  store = await import('@/lib/data/store');
  await store.getWorkspace();
  await store.insertRecords(personalScope(), 'memory', [
    memory('m1', 'Runway is the number I care about most; tell me months, not revenue.'),
    memory('m2', 'Deep work happens in the morning; meetings are for the afternoon.'),
    memory('m3', 'Prefers being told the uncomfortable version first.'),
    memory('m4', 'Quoting is manual and inconsistent across projects.', { capabilityId: 'sales' }),
  ] as never);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('recall ranks by what the question is about', () => {
  it('finds the record the question is actually about', async () => {
    const hits = await recall.recallMemory({ scope: personalScope(), text: 'how much runway do I have?', now: NOW });
    expect(hits.length).toBeGreaterThan(0);
    // By content, not by a fixture id: the seeded workspace has its own memories
    // and the point is that the *right* one wins, whoever wrote it.
    expect(hits[0]?.record.text.toLowerCase(), hits.map((h) => h.record.text.slice(0, 40)).join(' | ')).toContain('runway');
  }, 30_000);

  it('says which signal ranked it rather than implying semantics', async () => {
    // With no embedding-capable key stored this must be lexical, and must say so.
    const hits = await recall.recallMemory({ scope: personalScope(), text: 'runway', now: NOW });
    expect(hits[0]?.how).toBe('lexical');
  }, 30_000);

  it('returns nothing rather than everything when nothing matches', async () => {
    // The failure that makes retrieval useless: a query that matches nothing
    // returning the whole collection, ranked by noise.
    const hits = await recall.recallMemory({ scope: personalScope(), text: 'zebra parachute', now: NOW });
    expect(hits).toHaveLength(0);
  }, 30_000);

  it('honours a capability filter', async () => {
    const hits = await recall.recallMemory({
      scope: personalScope(),
      text: 'quoting',
      capabilityId: 'sales',
      now: NOW,
    });
    expect(hits.every((hit) => hit.record.capabilityId === 'sales')).toBe(true);
  }, 30_000);

  it('respects the limit', async () => {
    const hits = await recall.recallMemory({ scope: personalScope(), text: 'the and is', limit: 2, now: NOW });
    expect(hits.length).toBeLessThanOrEqual(2);
  }, 30_000);
});

describe('cosine similarity is safe to sort by', () => {
  it('scores identical vectors 1 and opposite −1', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 rather than NaN for degenerate input', () => {
    // A NaN in a comparator produces an order that changes between runs, which
    // is the worst possible failure for something the founder is meant to trust.
    for (const [a, b] of [[[], []], [[0, 0], [1, 1]], [[1, 2], [1, 2, 3]]] as const) {
      expect(Number.isNaN(cosineSimilarity(a, b))).toBe(false);
      expect(cosineSimilarity(a, b)).toBe(0);
    }
  });
});
