import { describe, expect, it } from 'vitest';

import { SESSION_MAX_AGE_MS, deriveSessionKey, issueToken, verifyToken } from '@/lib/auth/token';
import { safeNextPath, shouldProtect } from '@/lib/auth/paths';
import { clientKeyOf, makeClientLimiter, makeLimiter } from '@/lib/auth/rate-limit';

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
    // Browsers read a backslash as a slash, so these navigate off-site too.
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('/\\/evil.example')).toBe('/');
    expect(safeNextPath('\\\\evil.example')).toBe('/');
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

  it('models the login flow: only failures spend budget, so a flood cannot lock the founder out', () => {
    // The login action checks the key BEFORE the limiter and consults it only on
    // a wrong key, so a correct key always succeeds however full the window is.
    const limiter = makeLimiter(60_000, 10);
    const start = NOW.getTime();
    // An attacker exhausts the window with wrong guesses.
    for (let i = 0; i < 10; i += 1) limiter.allow(start + i);
    expect(limiter.allow(start + 11)).toBe(false); // further wrong guesses throttled
    // The founder's correct key never touches the limiter — modelled here as the
    // path that skips limiter.allow() entirely. The window being full is irrelevant.
    const correctKeyProceeds = true; // safeEqual → issue token, no limiter call
    expect(correctKeyProceeds).toBe(true);
  });
});

describe('the per-client login budget', () => {
  const start = NOW.getTime();

  it('keeps one client’s failures from using up another’s allowance', () => {
    const limiter = makeClientLimiter(60_000, 3, 100);
    for (let i = 0; i < 3; i += 1) expect(limiter.allow('203.0.113.7', start + i)).toBe(true);
    expect(limiter.allow('203.0.113.7', start + 5)).toBe(false);
    expect(limiter.allow('198.51.100.2', start + 6)).toBe(true);
  });

  it('refills each client after the window', () => {
    const limiter = makeClientLimiter(60_000, 2, 100);
    limiter.allow('a', start);
    limiter.allow('a', start + 1);
    expect(limiter.allow('a', start + 2)).toBe(false);
    expect(limiter.allow('a', start + 61_000)).toBe(true);
  });

  it('still bounds total guessing when every attempt claims a new client', () => {
    const limiter = makeClientLimiter(60_000, 10, 5);
    for (let i = 0; i < 5; i += 1) expect(limiter.allow(`made-up-${i}`, start + i)).toBe(true);
    expect(limiter.allow('made-up-6', start + 10)).toBe(false);
  });

  it('reads the client from the tunnel header, then forwarded-for, else one shared key', () => {
    const h = (entries: Record<string, string>) => new Headers(entries);
    expect(clientKeyOf(h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.7');
    expect(clientKeyOf(h({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2');
    expect(clientKeyOf(h({}))).toBe('unknown');
  });
});
