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
import { sqliteStore } from './adapters/sqlite-store';
import type { WorkspaceStore } from './store-port';
import type { CollectionName, ScopeData, WorkspaceRoot } from './schema';
import { emptyScopeData, normaliseRoot } from './schema';
import type { Scope } from '@/lib/domain';
import { companyScope, personalScope, scopeKey, sharedScope } from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import { buildInitialWorkspace } from './seed';

/**
 * The swap point. `OMNIOS_STORE=sqlite` keeps the workspace in one SQLite file;
 * anything else keeps the plain-JSON filesystem store. The default stays
 * filesystem deliberately — an env var must never silently move an existing
 * workspace out from under a founder.
 */
const adapter: WorkspaceStore =
  process.env.OMNIOS_STORE?.trim().toLowerCase() === 'sqlite' ? sqliteStore : fileSystemStore;

export function storeInfo(): { id: string; label: string; location: string } {
  return { id: adapter.id, label: adapter.label, location: adapter.describeLocation() };
}

/** Guards against two concurrent first-run seeds racing each other. */
let seeding: Promise<WorkspaceRoot> | null = null;

/**
 * A founder who sets `OMNIOS_STORE=sqlite` means "same workspace, database
 * backend" — not "start over". So before seeding a fresh workspace, a non-
 * filesystem adapter imports the existing JSON one if it is there: the root,
 * personal life, every company the root names, and every shared capability.
 * The JSON files are read, never touched, so flipping the variable back is
 * always safe. Returns `null` when there is nothing to import.
 */
async function importFromFileSystem(): Promise<WorkspaceRoot | null> {
  if (adapter.id === fileSystemStore.id) return null;
  const legacy = await fileSystemStore.readRoot();
  if (!legacy) return null;
  const root = normaliseRoot(legacy);
  const scopes: Scope[] = [
    personalScope(),
    ...root.companies.map((company) => companyScope(company.id)),
    ...capabilityIds().map(sharedScope),
  ];
  for (const scope of scopes) {
    const data = await fileSystemStore.readScope(scope);
    if (data) await adapter.writeScope(scope, data);
  }
  await adapter.writeRoot(root);
  return root;
}

export async function getWorkspace(): Promise<WorkspaceRoot> {
  const existing = await adapter.readRoot();
  if (existing) return normaliseRoot(existing);
  if (!seeding) {
    seeding = (async () => {
      const again = await adapter.readRoot();
      // Normalise the double-check read too: a root written by an older build
      // arrives raw, and returning it unwrapped skipped every field default.
      if (again) return normaliseRoot(again);
      const imported = await importFromFileSystem();
      if (imported) return imported;
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

/**
 * Read-modify-write of the workspace root, serialised end to end by the adapter.
 *
 * The read happens *inside* the write queue, so two callers arriving together —
 * a heartbeat recording its beat and a revokeGrant removing a grant — cannot
 * both read the same root and have the later write silently discard the
 * earlier one. That race once resurrected a revoked `PermissionGrant`, which is
 * a security regression, not a lost keystroke.
 */
export async function saveWorkspace(
  update: (current: WorkspaceRoot) => WorkspaceRoot,
): Promise<WorkspaceRoot> {
  await getWorkspace(); // ensure first-run seeding has happened
  return adapter.mutateRoot((current) => {
    const base = current ?? normaliseRoot({} as WorkspaceRoot);
    return { ...update(base), updatedAt: new Date().toISOString() };
  });
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
 * Read-modify-write for one scope, serialised end to end by the adapter.
 *
 * The read runs inside the scope file's write queue, so two Server Actions
 * mutating the same scope at once each see the other's result rather than both
 * reading one snapshot and the second overwriting the first — the difference
 * between "two records appended" and "one record silently lost".
 */
export async function mutateScope(
  scope: Scope,
  update: (data: ScopeData) => ScopeData,
): Promise<ScopeData> {
  await getWorkspace();
  return adapter.mutateScope(scope, update);
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
