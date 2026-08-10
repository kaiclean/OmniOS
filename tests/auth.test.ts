import { describe, expect, it } from 'vitest';

import { SESSION_MAX_AGE_MS, deriveSessionKey, issueToken, verifyToken } from '@/lib/auth/token';
import { safeNextPath, shouldProtect } from '@/lib/auth/paths';
import { makeLimiter } from '@/lib/auth/rate-limit';

/**
 * The access gate. These are the properties that make a tunnel safe to stand
 * up: tokens that cannot be forged or outlive their month, a protection
 * predicate with exactly the right holes, and a login that cannot be
 * dictionary-attacked at speed. Node 22 ships crypto.subtle, so the WebCrypto
 * paths run for real — no mocks.
 */

const NOW = new Date('2026-08-10T12:00:00.000Z');

describe('session tokens', () => {
  it('round-trips: issued now, verifies now', async () => {
    const key = await deriveSessionKey('test-access-key');
    const token = await issueToken(key, NOW);
    expect(await verifyToken(key, token, NOW)).toBe(true);
  });

  it('rejects forgery, malformed shapes, and the future', async () => {
    const key = await deriveSessionKey('test-access-key');
    const other = await deriveSessionKey('a-different-key');
    const token = await issueToken(key, NOW);

    expect(await verifyToken(other, token, NOW)).toBe(false);
    expect(await verifyToken(key, token.slice(0, -2), NOW)).toBe(false);
    expect(await verifyToken(key, 'v1.garbage', NOW)).toBe(false);
    expect(await verifyToken(key, undefined, NOW)).toBe(false);

    const future = await issueToken(key, new Date(NOW.getTime() + 10 * 60_000));
    expect(await verifyToken(key, future, NOW)).toBe(false);
  });

  it('expires after thirty days — and rotation kills every session', async () => {
    const key = await deriveSessionKey('test-access-key');
    const old = await issueToken(key, new Date(NOW.getTime() - SESSION_MAX_AGE_MS - 1000));
    expect(await verifyToken(key, old, NOW)).toBe(false);

    // Rotating the access key changes the derived key: nothing old verifies.
    const rotated = await deriveSessionKey('rotated-key');
    const current = await issueToken(key, NOW);
    expect(await verifyToken(rotated, current, NOW)).toBe(false);
  });
});

describe('what the gate covers', () => {
  it('protects the workspace and its APIs', () => {
    for (const path of ['/', '/companies/acme', '/security', '/api/brain-graph', '/timeline']) {
      expect(shouldProtect(path), path).toBe(true);
    }
  });

  it('exempts exactly the self-authenticating and pre-auth surfaces', () => {
    for (const path of [
      '/login',
      '/api/telegram/webhook',
      '/api/health',
      '/manifest.webmanifest',
      '/icons/app.svg',
      '/apple-icon',
      '/_next/data/x',
      '/favicon.ico',
    ]) {
      expect(shouldProtect(path), path).toBe(false);
    }
  });

  it('never lets the login page become an open redirect', () => {
    expect(safeNextPath('/companies/acme')).toBe('/companies/acme');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });
});

describe('the login rate limit', () => {
  it('allows ten a minute, refuses the eleventh, refills after the window', () => {
    const limiter = makeLimiter(60_000, 10);
    const start = NOW.getTime();
    for (let i = 0; i < 10; i += 1) expect(limiter.allow(start + i)).toBe(true);
    expect(limiter.allow(start + 11)).toBe(false);
    expect(limiter.allow(start + 61_000)).toBe(true);
  });
});
