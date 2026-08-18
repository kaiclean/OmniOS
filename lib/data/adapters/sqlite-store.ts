/**
 * SQLite workspace store — the database persistence adapter.
 *
 * Server-only. It keeps the whole workspace in one SQLite file inside the data
 * directory, using Node's built-in `node:sqlite` so no native dependency is
 * compiled or shipped. The document shape is unchanged: one JSON row per scope
 * and one for the root, so scope isolation stays physical (a row per partition)
 * and `normaliseScopeData`/`normaliseRoot` keep doing the schema-migration work
 * they already do for the filesystem adapter.
 *
 * Every call runs synchronously inside SQLite on one connection, and the
 * read-modify-write in `mutateRoot`/`mutateScope` is wrapped in an explicit
 * `BEGIN IMMEDIATE … COMMIT` with no awaits between read and write, so two
 * concurrent callers on this process cannot read one snapshot and have the
 * second write silently discard the first — the same serialisation guarantee
 * the filesystem adapter builds with write queues.
 *
 * Do not import this directly — go through `lib/data/store.ts`, which selects an
 * adapter, and set `OMNIOS_STORE=sqlite` to choose this one.
 */

import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { WorkspaceStore } from '../store-port';
import type { ScopeData, WorkspaceRoot } from '../schema';
import { emptyScopeData, normaliseRoot, normaliseScopeData } from '../schema';
import { dataDir } from '../data-dir';
import type { Scope } from '@/lib/domain';
import { scopeKey } from '@/lib/domain';

function databasePath(): string {
  return join(dataDir(), 'omnios.sqlite');
}

let handle: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (handle) return handle;
  mkdirSync(dataDir(), { recursive: true });
  const opened = new DatabaseSync(databasePath());
  // WAL keeps a crash mid-write from corrupting the previous committed state,
  // which is the same promise the filesystem adapter makes with temp+rename.
  opened.exec('PRAGMA journal_mode = WAL;');
  opened.exec(
    'CREATE TABLE IF NOT EXISTS root (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);',
  );
  opened.exec('CREATE TABLE IF NOT EXISTS scopes (key TEXT PRIMARY KEY, json TEXT NOT NULL);');
  handle = opened;
  return opened;
}

function readRow(sql: string, ...params: string[]): unknown | null {
  const row = db().prepare(sql).get(...params) as { json?: string } | undefined;
  if (!row?.json) return null;
  try {
    return JSON.parse(row.json) as unknown;
  } catch (error) {
    throw new Error(
      `OmniOS workspace row is corrupt in ${databasePath()}. Move the file aside and restart to reseed.`,
      { cause: error },
    );
  }
}

const UPSERT_ROOT =
  'INSERT INTO root (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json';
const UPSERT_SCOPE =
  'INSERT INTO scopes (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json';

/**
 * Runs `work` inside an immediate transaction. `work` must stay synchronous:
 * an await between the read and the write would reopen exactly the lost-update
 * race this wrapper exists to close.
 */
function inTransaction<T>(work: () => T): T {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export const sqliteStore: WorkspaceStore = {
  id: 'sqlite',
  label: 'SQLite database',

  async readRoot() {
    return readRow('SELECT json FROM root WHERE id = 1') as WorkspaceRoot | null;
  },

  async writeRoot(root) {
    db().prepare(UPSERT_ROOT).run(JSON.stringify(root));
  },

  async mutateRoot(transform) {
    return inTransaction(() => {
      const raw = readRow('SELECT json FROM root WHERE id = 1') as WorkspaceRoot | null;
      const next = transform(raw === null ? null : normaliseRoot(raw));
      db().prepare(UPSERT_ROOT).run(JSON.stringify(next));
      return next;
    });
  },

  async readScope(scope) {
    const raw = readRow('SELECT json FROM scopes WHERE key = ?', scopeKey(scope));
    return raw === null ? null : normaliseScopeData(raw);
  },

  async writeScope(scope, data: ScopeData) {
    db().prepare(UPSERT_SCOPE).run(scopeKey(scope), JSON.stringify(data));
  },

  async mutateScope(scope, transform) {
    return inTransaction(() => {
      const raw = readRow('SELECT json FROM scopes WHERE key = ?', scopeKey(scope));
      const current = raw === null ? emptyScopeData() : normaliseScopeData(raw);
      const next = transform(current);
      db().prepare(UPSERT_SCOPE).run(scopeKey(scope), JSON.stringify(next));
      return next;
    });
  },

  async dropScope(scope) {
    db().prepare('DELETE FROM scopes WHERE key = ?').run(scopeKey(scope));
  },

  async reset() {
    // Mirror the filesystem adapter: a reset wipes the whole data directory,
    // vault included, so "start over" means the same thing on every backend.
    if (handle) {
      handle.close();
      handle = null;
    }
    await rm(dataDir(), { recursive: true, force: true });
  },

  describeLocation() {
    return databasePath();
  },
};
