/**
 * The store facade.
 *
 * This is the only module the rest of OmniOS imports for persistence. It picks an
 * adapter, seeds an empty workspace on first run, and exposes scope-safe typed
 * reads and writes.
 *
 * Note the shape of the API: there is no `readEverything()`. Every read names a
 * scope. Cross-space aggregation exists — a founder looking at their own Finance
 * Center should see all of it — but it lives in `aggregate.ts`, is explicit at
 * every call site, and is never used to assemble context for an agent.
 */

import 'server-only';

import { fileSystemStore } from './adapters/fs-store';
import type { WorkspaceStore } from './store-port';
import type { CollectionName, ScopeData, WorkspaceRoot } from './schema';
import { emptyScopeData, normaliseRoot } from './schema';
import type { Scope } from '@/lib/domain';
import { scopeKey } from '@/lib/domain';
import { buildInitialWorkspace } from './seed';

/**
 * The swap point. Replace this with a Postgres/Supabase/SQLite adapter and the
 * entire application above keeps working unchanged.
 */
const adapter: WorkspaceStore = fileSystemStore;

export function storeInfo(): { id: string; label: string; location: string } {
  return { id: adapter.id, label: adapter.label, location: adapter.describeLocation() };
}

/** Guards against two concurrent first-run seeds racing each other. */
let seeding: Promise<WorkspaceRoot> | null = null;

export async function getWorkspace(): Promise<WorkspaceRoot> {
  const existing = await adapter.readRoot();
  if (existing) return normaliseRoot(existing);
  if (!seeding) {
    seeding = (async () => {
      const again = await adapter.readRoot();
      if (again) return again;
      const { root, scopes } = buildInitialWorkspace();
      for (const [scope, data] of scopes) {
        await adapter.writeScope(scope, data);
      }
      await adapter.writeRoot(root);
      return root;
    })().finally(() => {
      seeding = null;
    });
  }
  return seeding;
}

export async function saveWorkspace(
  update: (current: WorkspaceRoot) => WorkspaceRoot,
): Promise<WorkspaceRoot> {
  const current = await getWorkspace();
  const next = { ...update(current), updatedAt: new Date().toISOString() };
  await adapter.writeRoot(next);
  return next;
}

/* ------------------------------------------------------- scoped access ---- */

export async function readScope(scope: Scope): Promise<ScopeData> {
  await getWorkspace();
  return (await adapter.readScope(scope)) ?? emptyScopeData();
}

export async function readCollection<K extends CollectionName>(
  scope: Scope,
  collection: K,
): Promise<ScopeData[K]> {
  const data = await readScope(scope);
  return data[collection];
}

/**
 * Read-modify-write for one scope. The adapter serialises writes per scope file,
 * so concurrent Server Actions queue rather than clobber each other.
 */
export async function mutateScope(
  scope: Scope,
  update: (data: ScopeData) => ScopeData,
): Promise<ScopeData> {
  const current = await readScope(scope);
  const next = update(current);
  await adapter.writeScope(scope, next);
  return next;
}

export async function insertRecords<K extends CollectionName>(
  scope: Scope,
  collection: K,
  records: ScopeData[K],
): Promise<void> {
  await mutateScope(scope, (data) => ({
    ...data,
    [collection]: [...records, ...data[collection]] as ScopeData[K],
  }));
}

export async function updateRecord<K extends CollectionName>(
  scope: Scope,
  collection: K,
  id: string,
  patch: Partial<ScopeData[K][number]>,
): Promise<void> {
  await mutateScope(scope, (data) => ({
    ...data,
    [collection]: data[collection].map((record) =>
      (record as { id: string }).id === id
        ? { ...record, ...patch, updatedAt: new Date().toISOString() }
        : record,
    ) as ScopeData[K],
  }));
}

export async function removeRecord<K extends CollectionName>(
  scope: Scope,
  collection: K,
  id: string,
): Promise<void> {
  await mutateScope(scope, (data) => ({
    ...data,
    [collection]: data[collection].filter(
      (record) => (record as { id: string }).id !== id,
    ) as ScopeData[K],
  }));
}

export async function writeScopeData(scope: Scope, data: ScopeData): Promise<void> {
  await adapter.writeScope(scope, data);
}

export async function dropScope(scope: Scope): Promise<void> {
  await adapter.dropScope(scope);
}

export async function resetWorkspace(): Promise<void> {
  await adapter.reset();
}

/** Exposed for diagnostics in Settings. */
export function debugScopeKey(scope: Scope): string {
  return scopeKey(scope);
}
