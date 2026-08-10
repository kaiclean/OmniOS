/**
 * What the access gate covers — pure, so the proxy stays a thin shell and the
 * real decisions are unit-tested.
 *
 * Everything is protected unless it must not be: the Telegram webhook
 * authenticates itself with its own secret, /api/health self-authenticates so
 * the heartbeat needs no cookie, and the login page plus install assets
 * (manifest, icons) must be reachable before a session exists. Notably inside
 * the boundary: /api/brain-graph — it serves the founder's memory graph and
 * was reachable by anyone before this file existed.
 */

const EXEMPT_EXACT = new Set([
  '/login',
  '/api/telegram/webhook',
  '/api/health',
  '/manifest.webmanifest',
  '/icon.svg',
  '/favicon.ico',
]);

const EXEMPT_PREFIXES = ['/_next/', '/icons/', '/apple-icon'];

export function shouldProtect(pathname: string): boolean {
  if (EXEMPT_EXACT.has(pathname)) return false;
  return !EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Where to send the founder after login. Only a same-origin path survives:
 * anything protocol-shaped or protocol-relative would make the login page an
 * open redirect.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}
