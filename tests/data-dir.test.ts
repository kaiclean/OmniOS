import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { dataDir, isEphemeralDataDir } from '@/lib/data/data-dir';

// The resolver is pure over process.env, so each test states its whole world
// and the suite restores whatever the real environment had.
const SAVED = ['OMNIOS_DATA_DIR', 'VERCEL', 'AWS_LAMBDA_FUNCTION_NAME'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(SAVED.map((key) => [key, process.env[key]]));
  for (const key of SAVED) delete process.env[key];
});

afterEach(() => {
  for (const key of SAVED) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('the data directory resolver', () => {
  it('defaults to .omnios-data beside the app on a real machine', () => {
    expect(dataDir()).toBe(resolve(process.cwd(), '.omnios-data'));
    expect(isEphemeralDataDir()).toBe(false);
  });

  it('always honours an explicit OMNIOS_DATA_DIR, serverless or not', () => {
    process.env.OMNIOS_DATA_DIR = '/somewhere/else';
    expect(dataDir()).toBe(resolve('/somewhere/else'));
    process.env.VERCEL = '1';
    expect(dataDir()).toBe(resolve('/somewhere/else'));
    // Configured storage is the founder's own choice — never labelled ephemeral.
    expect(isEphemeralDataDir()).toBe(false);
  });

  it('falls back to the temp dir on Vercel, where the cwd is a read-only snapshot', () => {
    process.env.VERCEL = '1';
    expect(dataDir()).toBe(join(tmpdir(), 'omnios-data'));
    expect(isEphemeralDataDir()).toBe(true);
  });

  it('treats a bare Lambda the same way', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'omnios';
    expect(dataDir()).toBe(join(tmpdir(), 'omnios-data'));
    expect(isEphemeralDataDir()).toBe(true);
  });

  it('ignores a whitespace-only OMNIOS_DATA_DIR rather than resolving it to cwd', () => {
    process.env.OMNIOS_DATA_DIR = '   ';
    expect(dataDir()).toBe(resolve(process.cwd(), '.omnios-data'));
  });
});
