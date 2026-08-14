import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { dataDir, isEphemeralDataDir, resetDataDirForTests } from '@/lib/data/data-dir';

// The resolver caches one probe per process, so every case states its whole
// world: clear the env, clear the cache, restore both afterwards.
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env.OMNIOS_DATA_DIR;
  delete process.env.OMNIOS_DATA_DIR;
  resetDataDirForTests();
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.OMNIOS_DATA_DIR;
  else process.env.OMNIOS_DATA_DIR = savedEnv;
  resetDataDirForTests();
  vi.restoreAllMocks();
});

describe('the data directory resolver', () => {
  it('defaults to .omnios-data beside the app on a machine with a writable disk', () => {
    expect(dataDir()).toBe(resolve(process.cwd(), '.omnios-data'));
    expect(isEphemeralDataDir()).toBe(false);
  });

  it('always honours an explicit OMNIOS_DATA_DIR', () => {
    process.env.OMNIOS_DATA_DIR = '/somewhere/else';
    expect(dataDir()).toBe(resolve('/somewhere/else'));
    expect(isEphemeralDataDir()).toBe(false);
  });

  it('falls back to the temp dir when the local data dir cannot exist, and says so', () => {
    // /dev/null/… can never become a directory, on any platform vitest runs on.
    vi.spyOn(process, 'cwd').mockReturnValue('/dev/null/nowhere');
    expect(dataDir()).toBe(join(tmpdir(), 'omnios-data'));
    expect(isEphemeralDataDir()).toBe(true);
  });

  it('labels a configured dir under the temp root ephemeral rather than trusting it', () => {
    // Pointing OMNIOS_DATA_DIR at /tmp must not silence the banner while
    // every write still evaporates — that is the exact discover-by-losing-data
    // outcome the banner exists to prevent.
    process.env.OMNIOS_DATA_DIR = join(tmpdir(), 'my-omnios');
    expect(dataDir()).toBe(join(tmpdir(), 'my-omnios'));
    expect(isEphemeralDataDir()).toBe(true);
  });

  it('ignores a whitespace-only OMNIOS_DATA_DIR rather than resolving it to cwd', () => {
    process.env.OMNIOS_DATA_DIR = '   ';
    expect(dataDir()).toBe(resolve(process.cwd(), '.omnios-data'));
  });

  it('probes once and caches: a later env change without a restart is invisible', () => {
    expect(dataDir()).toBe(resolve(process.cwd(), '.omnios-data'));
    process.env.OMNIOS_DATA_DIR = '/somewhere/else';
    // Still the first answer — the store and the vault must never disagree
    // about where data lives within one process lifetime.
    expect(dataDir()).toBe(resolve(process.cwd(), '.omnios-data'));
  });
});
