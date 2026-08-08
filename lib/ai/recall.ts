import 'server-only';

/**
 * Which memories this question actually needs.
 *
 * `MemoryQuery` has been declared in the domain since memory shipped and never
 * had an implementation — memory reached the assistant as "whatever
 * `loadContext` happened to load for this scope", unranked. With a handful of
 * records that is fine. It stops being fine at the point the founder has used
 * the thing for a year, which is the point the product is for.
 *
 * Two ranking modes, one code path. When both the query and a record carry
 * vectors, similarity decides. When they do not — which is the case on any
 * workspace without an embedding-capable key — the same function falls back to
 * lexical overlap. Both then get the same recency and strength weighting, so the
 * *shape* of retrieval does not change when embeddings arrive; only its
 * sharpness does.
 *
 * Scope isolation is not negotiated here. This ranks records it was handed; the
 * caller reads them from exactly one scope, and nothing in this file can widen
 * that.
 */

import type { MemoryRecord, Scope } from '@/lib/domain';
import { readCollection } from '@/lib/data/store';
import { cosineSimilarity, embedTexts } from './embeddings';

export interface RecalledMemory {
  readonly record: MemoryRecord;
  readonly score: number;
  /** Which signal ranked it, so the UI can say so rather than imply semantics. */
  readonly how: 'semantic' | 'lexical';
}

/** Words too common to carry meaning; keeping them makes every record match. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'to', 'of',
  'in', 'on', 'at', 'for', 'with', 'my', 'i', 'me', 'it', 'this', 'that', 'do', 'does',
  'how', 'what', 'when', 'why', 'should', 'would', 'can', 'about',
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

/**
 * Overlap weighted by rarity — a crude IDF, and deliberately crude.
 *
 * A record sharing "runway" with the question is a better hit than one sharing
 * "meeting", and counting raw overlap misses that. Rarity is computed across the
 * candidate set rather than a corpus, because the candidate set is the only
 * thing that exists here and a global count would need an index this is meant to
 * avoid needing.
 */
function lexicalScores(query: string, records: readonly MemoryRecord[]): number[] {
  const queryTerms = new Set(terms(query));
  if (queryTerms.size === 0) return records.map(() => 0);

  const documentFrequency = new Map<string, number>();
  const perRecord = records.map((record) => {
    const set = new Set(terms(`${record.text} ${record.tags.join(' ')}`));
    for (const word of set) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    return set;
  });

  return perRecord.map((set) => {
    let score = 0;
    for (const word of queryTerms) {
      if (!set.has(word)) continue;
      score += Math.log(1 + records.length / (documentFrequency.get(word) ?? 1));
    }
    return score / Math.sqrt(queryTerms.size);
  });
}

/** Older memories matter less, but never to zero — a year-old rule is still a rule. */
function recencyWeight(record: MemoryRecord, now: Date): number {
  const age = now.getTime() - new Date(record.updatedAt ?? record.createdAt).getTime();
  const days = Math.max(0, age / 86_400_000);
  return 0.6 + 0.4 * Math.exp(-days / 120);
}

export interface RecallOptions {
  readonly scope: Scope;
  readonly text: string;
  readonly capabilityId?: string;
  readonly limit?: number;
  readonly now?: Date;
}

export async function recallMemory(options: RecallOptions): Promise<RecalledMemory[]> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 40);

  // One scope. The caller's scope, never a union of them.
  const all = await readCollection(options.scope, 'memory');
  const candidates = options.capabilityId
    ? all.filter((record) => record.capabilityId === options.capabilityId)
    : all;
  if (candidates.length === 0) return [];

  const stored = candidates.map((record) => record.embedding);
  const haveVectors = stored.every((vector) => vector && vector.length > 0);

  let how: RecalledMemory['how'] = 'lexical';
  let relevance = lexicalScores(options.text, candidates);

  if (haveVectors) {
    // Only the query needs embedding — the records were embedded on write. If
    // that one call fails, lexical scores are already computed and stand.
    const queryVector = (await embedTexts([options.text]))?.vectors[0];
    if (queryVector && queryVector.length === (stored[0]?.length ?? -1)) {
      how = 'semantic';
      relevance = stored.map((vector) => cosineSimilarity(queryVector, vector ?? []));
    }
  }

  return candidates
    .map((record, index) => ({
      record,
      // Strength is the founder's own signal about how much a memory matters,
      // and it decays unless reinforced. Relevance decides *whether* a record is
      // about the question; strength and recency decide which of the relevant
      // ones to spend context on.
      score: (relevance[index] ?? 0) * recencyWeight(record, now) * (0.5 + 0.5 * record.strength),
      how,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
