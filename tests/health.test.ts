import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * The heartbeat's landing pad. What matters: an unauthorised request learns
 * nothing (bare 401), an authorised one records the beat, and with no access
 * key configured the route says the gate is open instead of pretending.
 */

let dir: string;
let route: typeof import('@/app/api/health/route');
let store: typeof import('@/lib/data/store');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-health-'));
  process.env.OMNIOS_DATA_DIR = dir;
  route = await import('@/app/api/health/route');
  store = await import('@/lib/data/store');
  await store.getWorkspace();
}, 60_000);

afterEach(() => {
  delete process.env.OMNIOS_ACCESS_KEY;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('/api/health', () => {
  it('says the gate is open when no key is configured, and writes nothing', async () => {
    const response = await route.GET(new Request('http://localhost/api/health'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; auth?: string };
    expect(body.ok).toBe(true);
    expect(body.auth).toBe('off');
    expect((await store.getWorkspace()).lastHeartbeatAt).toBeNull();
  });

  it('gives an unauthorised request a bare 401 — no body, no hints', async () => {
    process.env.OMNIOS_ACCESS_KEY = 'the-key';
    const bare = await route.GET(new Request('http://localhost/api/health'));
    expect(bare.status).toBe(401);
    expect(await bare.text()).toBe('');

    const wrong = await route.GET(
      new Request('http://localhost/api/health', {
        headers: { 'x-omnios-health-key': 'not-the-key' },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it('records the beat for a request carrying the key', async () => {
    process.env.OMNIOS_ACCESS_KEY = 'the-key';
    const response = await route.GET(
      new Request('http://localhost/api/health', {
        headers: { 'x-omnios-health-key': 'the-key' },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; at: string };
    expect(body.ok).toBe(true);

    const workspace = await store.getWorkspace();
    expect(workspace.lastHeartbeatAt).toBe(body.at);
  });
});
