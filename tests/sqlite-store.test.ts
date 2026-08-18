import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { companyScope, personalScope } from '@/lib/domain';

/**
 * The SQLite backend, exercised through the store facade.
 *
 * `OMNIOS_STORE=sqlite` is set before the store module loads because the
 * adapter is chosen at import time — which is exactly how production selects
 * it, so these tests prove the swap point works end to end: seeding, scoped
 * round-trips, isolation between partitions, the serialisation guarantee under
 * racing writers, normalisation of documents from older builds, and a reset
 * that actually removes the database file.
 */

let dir: string;
let store: typeof import('@/lib/data/store');
let schema: typeof import('@/lib/data/schema');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-sqlite-'));
  process.env.OMNIOS_DATA_DIR = dir;
  process.env.OMNIOS_STORE = 'sqlite';
  store = await import('@/lib/data/store');
  schema = await import('@/lib/data/schema');
  await store.getWorkspace();
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
  delete process.env.OMNIOS_STORE;
});

describe('sqlite workspace store through the facade', () => {
  it('is the active adapter and reports its location honestly', () => {
    const info = store.storeInfo();
    expect(info.id).toBe('sqlite');
    expect(info.location).toBe(join(dir, 'omnios.sqlite'));
  });

  it('seeded a workspace into one database file', async () => {
    await expect(stat(join(dir, 'omnios.sqlite'))).resolves.toBeTruthy();
    const workspace = await store.getWorkspace();
    expect(Array.isArray(workspace.companies)).toBe(true);
  });

  it('round-trips records and keeps scopes isolated', async () => {
    await store.insertRecords(personalScope(), 'tasks', [{ id: 'task-personal' } as never]);
    await store.insertRecords(companyScope('acme'), 'tasks', [{ id: 'task-company' } as never]);

    const personal = await store.readCollection(personalScope(), 'tasks');
    const company = await store.readCollection(companyScope('acme'), 'tasks');
    expect(personal.some((task) => task.id === 'task-personal')).toBe(true);
    expect(personal.some((task) => task.id === 'task-company')).toBe(false);
    expect(company.map((task) => task.id)).toEqual(['task-company']);
  });

  it('keeps every record when 20 inserts race into one scope', async () => {
    const scope = companyScope('race');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.insertRecords(scope, 'tasks', [{ id: `task-${i}` } as never]),
      ),
    );
    const after = await store.readCollection(scope, 'tasks');
    expect(after).toHaveLength(20);
  });

  it('normalises a document written by an older build', async () => {
    const scope = companyScope('older-build');
    // A partial document: only tasks present, every later collection missing.
    await store.writeScopeData(scope, { tasks: [{ id: 't1' }] } as never);
    const read = await store.readScope(scope);
    expect(read.tasks).toHaveLength(1);
    expect(read.meetings).toEqual([]);
    expect(schema.COLLECTION_NAMES.every((name) => Array.isArray(read[name]))).toBe(true);
  });

  it('drops a scope without touching its neighbours', async () => {
    await store.dropScope(companyScope('acme'));
    expect(await store.readCollection(companyScope('acme'), 'tasks')).toEqual([]);
    const personal = await store.readCollection(personalScope(), 'tasks');
    expect(personal.some((task) => task.id === 'task-personal')).toBe(true);
  });

  it('reset removes the database file and the store reseeds cleanly', async () => {
    await store.resetWorkspace();
    await expect(stat(join(dir, 'omnios.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
    const workspace = await store.getWorkspace();
    expect(Array.isArray(workspace.companies)).toBe(true);
  });
});
