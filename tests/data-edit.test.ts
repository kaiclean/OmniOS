import { describe, expect, it } from 'vitest';

import { parseCollectionInput } from '@/lib/data/edit';

/**
 * The data editor's gate.
 *
 * The editor writes whatever the founder pastes, so the one thing this helper
 * must guarantee is the structural contract the rest of the system assumes:
 * a JSON array of objects, each with a unique string id. Everything else is
 * deliberately allowed through — it is the founder's data.
 */

describe('parseCollectionInput', () => {
  it('accepts a valid collection', () => {
    const result = parseCollectionInput('tasks', '[{"id":"t1","title":"Ship"},{"id":"t2"}]');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.collection).toBe('tasks');
      expect(result.records).toHaveLength(2);
    }
  });

  it('accepts an empty array — deleting everything is a legitimate edit', () => {
    const result = parseCollectionInput('finance', '[]');
    expect(result.ok).toBe(true);
  });

  it('rejects a collection OmniOS does not store', () => {
    const result = parseCollectionInput('secrets', '[]');
    expect(result.ok).toBe(false);
  });

  it('rejects invalid JSON', () => {
    const result = parseCollectionInput('tasks', '[{"id": "t1"'); // truncated
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });

  it('rejects a non-array', () => {
    expect(parseCollectionInput('tasks', '{"id":"t1"}').ok).toBe(false);
    expect(parseCollectionInput('tasks', '"tasks"').ok).toBe(false);
  });

  it('rejects entries that are not objects', () => {
    expect(parseCollectionInput('tasks', '[1,2]').ok).toBe(false);
    expect(parseCollectionInput('tasks', '[["id"]]').ok).toBe(false);
    expect(parseCollectionInput('tasks', '[null]').ok).toBe(false);
  });

  it('rejects a record without a string id', () => {
    expect(parseCollectionInput('tasks', '[{"title":"no id"}]').ok).toBe(false);
    expect(parseCollectionInput('tasks', '[{"id":42}]').ok).toBe(false);
    expect(parseCollectionInput('tasks', '[{"id":"  "}]').ok).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const result = parseCollectionInput('tasks', '[{"id":"t1"},{"id":"t1"}]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('t1');
  });
});
