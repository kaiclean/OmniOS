/**
 * Session tokens for remote access — WebCrypto only, on purpose.
 *
 * This module is shared by three very different runtimes: the edge proxy (no
 * Node APIs at all), Node route handlers and Server Actions, and vitest. The
 * intersection is `globalThis.crypto.subtle`, so nothing here may import
 * `node:crypto`, the vault, or anything `server-only`.
 *
 * The signing key derives from the founder's access key rather than living
 * anywhere itself — which makes key rotation the revocation mechanism: change
 * `OMNIOS_ACCESS_KEY` and every cookie ever issued stops verifying.
 */

export const SESSION_COOKIE = 'omnios_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

const VERSION = 'v1';
const CONTEXT = 'omnios-session-v1';

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Access key → session HMAC key. Two steps so the raw access key is never the
 * signing key: the key signs a fixed context string, and that digest becomes
 * the session key. Deterministic, so every runtime derives the same key from
 * the same env var without sharing state.
 */
export async function deriveSessionKey(accessKey: string): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(accessKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', rawKey, encoder.encode(CONTEXT));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function issueToken(key: CryptoKey, now: Date = new Date()): Promise<string> {
  const payload = `${VERSION}.${now.getTime()}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/**
 * Constant-time by construction: the only comparison is `crypto.subtle.verify`
 * over the recomputed HMAC. Malformed shapes, future timestamps and expired
 * sessions are all rejected before any cryptography runs.
 */
export async function verifyToken(
  key: CryptoKey,
  token: string | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return false;
  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  // A minute of forward skew, no more: a token from the future is a forgery.
  if (issuedAt > now.getTime() + 60_000) return false;
  if (now.getTime() - issuedAt > SESSION_MAX_AGE_MS) return false;

  const signature = parts[2] ?? '';
  const base64 = signature.replace(/-/g, '+').replace(/_/g, '/');
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    return false;
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${parts[0]}.${parts[1]}`));
}
