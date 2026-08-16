/**
 * Validation for the direct data editor.
 *
 * The editor in Settings lets the founder paste a collection as JSON and write
 * it straight into a scope. That power needs one narrow gate: the input must be
 * an array of records that each carry a unique string `id`, because every store
 * helper (`updateRecord`, `removeRecord`) and every React key assumes exactly
 * that. Deeper field validation stays at the real edges (forms, generators),
 * same as `normaliseScopeData` — the editor is deliberately a raw tool.
 *
 * Pure and dependency-free so it is trivially testable and safe to import from
 * a Server Action.
 */

import type { CollectionName } from './schema';
import { COLLECTION_NAMES } from './schema';

export type CollectionInput =
  | { readonly ok: true; readonly collection: CollectionName; readonly records: ReadonlyArray<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

export function parseCollectionInput(collection: string, jsonText: string): CollectionInput {
  if (!(COLLECTION_NAMES as readonly string[]).includes(collection)) {
    return { ok: false, error: `"${collection}" is not a collection OmniOS stores.` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'That is not valid JSON. Nothing was changed.' };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'A collection is a JSON array of records. Nothing was changed.' };
  }

  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `Record ${index + 1} is not an object. Nothing was changed.` };
    }
    const id = (entry as Record<string, unknown>).id;
    if (typeof id !== 'string' || id.trim() === '') {
      return {
        ok: false,
        error: `Record ${index + 1} is missing a string "id". Every record needs one. Nothing was changed.`,
      };
    }
    if (seen.has(id)) {
      return { ok: false, error: `Two records share the id "${id}". Nothing was changed.` };
    }
    seen.add(id);
  }

  return {
    ok: true,
    collection: collection as CollectionName,
    records: parsed as ReadonlyArray<Record<string, unknown>>,
  };
}
