import 'server-only';

/**
 * Read-only executors: workspace search and single-record lookup.
 *
 * `read` tier. Both name a scope for every collection they touch, so a search
 * cannot return a record from another space.
 */

import type { ToolExecutor } from '@/lib/domain';
import { readCollection } from '@/lib/data/store';
import { SEARCHABLE_COLLECTIONS } from '../registry';
import { argNumber, argText } from '../index';
import { ok, refuse, optText } from './shared';

/**
 * The text fields worth matching, across every record shape.
 *
 * Records do not share a base beyond `ScopedRecord`, so search is
 * shape-tolerant rather than typed per collection: it looks at the handful of
 * fields that carry human words and ignores the rest. A field that does not
 * exist on a given record is simply absent, which is what makes one function
 * work across twenty collections without knowing any of them.
 */
const SEARCHABLE_FIELDS = [
  'title', 'name', 'label', 'text', 'summary', 'detail', 'notes',
  'description', 'question', 'intent', 'note', 'body',
] as const;

function searchableText(record: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const field of SEARCHABLE_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value) parts.push(value);
  }
  return parts.join(' ').toLowerCase();
}

/** One line per hit, carrying the id — the only handle `get_record` accepts. */
function describeHit(collection: string, record: Readonly<Record<string, unknown>>): string {
  const label =
    ['title', 'name', 'label', 'text', 'summary'].map((f) => record[f]).find((v) => typeof v === 'string' && v) ??
    '(untitled)';
  const status = typeof record['status'] === 'string' ? ` · ${record['status']}` : '';
  return `${collection} ${String(record['id'])} — ${String(label).slice(0, 120)}${status}`;
}

export const searchWorkspace: ToolExecutor = async (ctx, args) => {
  const query = argText(args, 'query').toLowerCase().trim();
  if (!query) return refuse('Nothing to search for.', 'A search needs at least one word.');

  const only = optText(args, 'collection');
  const limit = Math.min(Math.max(argNumber(args, 'limit') ?? 10, 1), 40);
  const collections = only
    ? [only]
    : (SEARCHABLE_COLLECTIONS as readonly string[]);

  const words = query.split(/\s+/).filter(Boolean);
  const hits: string[] = [];

  for (const collection of collections) {
    const records = (await readCollection(
      ctx.scope,
      collection as Parameters<typeof readCollection>[1],
    )) as unknown as ReadonlyArray<Record<string, unknown>>;

    for (const record of records) {
      const haystack = searchableText(record);
      // Every word must appear. An OR would return the whole workspace for a
      // two-word question, which is the same as returning nothing useful.
      if (!words.every((word) => haystack.includes(word))) continue;
      hits.push(describeHit(collection, record));
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }

  return ok(
    hits.length === 0
      ? `Nothing in this space matches “${query}”.`
      : `${hits.length} match${hits.length === 1 ? '' : 'es'} for “${query}”:\n${hits.join('\n')}`,
  );
};

export const getRecord: ToolExecutor = async (ctx, args) => {
  const collection = argText(args, 'collection');
  const recordId = argText(args, 'recordId');

  const records = (await readCollection(
    ctx.scope,
    collection as Parameters<typeof readCollection>[1],
  )) as unknown as ReadonlyArray<Record<string, unknown>>;
  const found = records.find((record) => record['id'] === recordId);

  if (!found) {
    // Named plainly rather than as an error: an id that is not here is a fact
    // about this space, and the assistant should say so and move on.
    return ok(`No ${collection} record with id ${recordId} exists in this space.`);
  }

  const readable = Object.entries(found)
    .filter(([key, value]) => key !== 'scope' && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join('\n');

  return ok(`${collection} ${recordId}\n${readable}`);
};
