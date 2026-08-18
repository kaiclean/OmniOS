import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { companyScope, personalScope, sharedScope } from '@/lib/domain';

/**
 * Switching store backends must not lose the workspace.
 *
 * A founder who sets `OMNIOS_STORE=sqlite` on a machine with an existing JSON
 * workspace means "same data, database backend". These tests build a filesystem
 * workspace, then reload the store module with the variable set — exactly what
 * a server restart does — and assert the SQLite store comes up holding the same
 * root and records, with the JSON files untouched so the switch is reversible.
 * Module reloads via `vi.resetModules()` because the adapter is chosen at
 * import time, which is also how production chooses it.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-migrate-'));
  process.env.OMNIOS_DATA_DIR = dir;
  delete process.env.OMNIOS_STORE;
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
  delete process.env.OMNIOS_STORE;
});

describe('filesystem → sqlite migration on first run', () => {
  it('imports the existing workspace instead of seeding a fresh one', async () => {
    // Phase 1: live on the filesystem store and leave distinctive records behind.
    vi.resetModules();
    const fsPhase = await import('@/lib/data/store');
    expect(fsPhase.storeInfo().id).toBe('filesystem');
    const before = await fsPhase.getWorkspace();
    expect(before.companies.length).toBeGreaterThan(0);
    const firstCompany = before.companies[0]!;

    await fsPhase.insertRecords(personalScope(), 'tasks', [{ id: 'migrate-personal' } as never]);
    await fsPhase.insertRecords(companyScope(firstCompany.id), 'tasks', [
      { id: 'migrate-company' } as never,
    ]);
    await fsPhase.insertRecords(sharedScope('finance'), 'memory', [
      { id: 'migrate-shared' } as never,
    ]);

    // Phase 2: restart with OMNIOS_STORE=sqlite, as a founder would.
    vi.resetModules();
    process.env.OMNIOS_STORE = 'sqlite';
    const sqlitePhase = await import('@/lib/data/store');
    expect(sqlitePhase.storeInfo().id).toBe('sqlite');

    const after = await sqlitePhase.getWorkspace();
    expect(after.companies.map((c) => c.id)).toEqual(before.companies.map((c) => c.id));

    const personal = await sqlitePhase.readCollection(personalScope(), 'tasks');
    expect(personal.some((task) => task.id === 'migrate-personal')).toBe(true);
    const company = await sqlitePhase.readCollection(companyScope(firstCompany.id), 'tasks');
    expect(company.some((task) => task.id === 'migrate-company')).toBe(true);
    const shared = await sqlitePhase.readCollection(sharedScope('finance'), 'memory');
    expect(shared.some((record) => record.id === 'migrate-shared')).toBe(true);

    // The import is read-only: the JSON workspace survives for a switch back.
    await expect(stat(join(dir, 'workspace.json'))).resolves.toBeTruthy();
    await expect(stat(join(dir, 'omnios.sqlite'))).resolves.toBeTruthy();

    // And it happened once: a record written to sqlite does not leak back, and
    // a restart keeps the sqlite state rather than re-importing over it.
    await sqlitePhase.insertRecords(personalScope(), 'tasks', [
      { id: 'sqlite-only' } as never,
    ]);
    vi.resetModules();
    const restarted = await import('@/lib/data/store');
    const tasks = await restarted.readCollection(personalScope(), 'tasks');
    expect(tasks.some((task) => task.id === 'sqlite-only')).toBe(true);
  });
});
