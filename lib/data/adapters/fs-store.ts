/**
 * Filesystem workspace store — the V1 persistence adapter.
 *
 * Server-only. It writes plain JSON under `.omnios-data/`, one file per scope, so
 * a founder can read, back up, sync or delete their own data with a file manager.
 * Writes are atomic (temp file + rename) and serialised per file, so two Server
 * Actions arriving at once cannot interleave and corrupt a scope.
 *
 * Do not import this directly — go through `lib/data/store.ts`, which is the seam
 * a Postgres/Supabase/SQLite adapter drops into.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { WorkspaceStore } from '../store-port';
import type { ScopeData, WorkspaceRoot } from '../schema';
import { normaliseScopeData } from '../schema';
import type { Scope } from '@/lib/domain';
import { scopeKey } from '@/lib/domain';

function dataDir(): string {
  const configured = process.env.OMNIOS_DATA_DIR?.trim();
  return configured ? resolve(configured) : resolve(process.cwd(), '.omnios-data');
}

/**
 * Scope keys contain user-supplied company ids. Hashing the key keeps a hostile
 * or merely odd id (`../../etc`) from escaping the data directory, while the
 * readable prefix keeps the directory browsable by a human.
 */
function scopeFilePath(scope: Scope): string {
  const key = scopeKey(scope);
  const safePrefix = key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 8);
  return join(dataDir(), 'scopes', `${safePrefix}.${digest}.json`);
}

function rootFilePath(): string {
  return join(dataDir(), 'workspace.json');
}

/**
 * One promise chain per file path. Awaiting the previous write before starting the
 * next makes concurrent Server Actions safe without a lock file.
 */
const writeQueues = new Map<string, Promise<unknown>>();

function serialise<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous.then(work, work);
  writeQueues.set(
    path,
    next.catch(() => undefined),
  );
  return next;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new Error(
        `OmniOS workspace file is corrupt: ${path}. Move it aside and restart to reseed.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export const fileSystemStore: WorkspaceStore = {
  id: 'filesystem',
  label: 'Local filesystem',

  async readRoot() {
    return readJson<WorkspaceRoot>(rootFilePath());
  },

  async writeRoot(root) {
    const path = rootFilePath();
    await serialise(path, () => writeJsonAtomic(path, root));
  },

  async readScope(scope) {
    const raw = await readJson<unknown>(scopeFilePath(scope));
    return raw === null ? null : normaliseScopeData(raw);
  },

  async writeScope(scope, data: ScopeData) {
    const path = scopeFilePath(scope);
    await serialise(path, () => writeJsonAtomic(path, data));
  },

  async dropScope(scope) {
    const path = scopeFilePath(scope);
    await serialise(path, () => rm(path, { force: true }));
  },

  async reset() {
    await rm(dataDir(), { recursive: true, force: true });
  },

  describeLocation() {
    return dataDir();
  },
};
