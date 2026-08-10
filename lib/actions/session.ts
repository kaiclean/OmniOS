'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { safeEqual } from '@/lib/secrets/vault';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, deriveSessionKey, issueToken } from '@/lib/auth/token';
import { safeNextPath } from '@/lib/auth/paths';
import { makeLimiter } from '@/lib/auth/rate-limit';

/**
 * The one place a session begins.
 *
 * The submitted key is compared in constant time against the environment and
 * never echoed anywhere — not into state, not into logs, not into the error.
 * Success sets an HttpOnly cookie whose signature derives from the access key
 * itself, so rotating the key invalidates every session ever issued.
 */

const limiter = makeLimiter();

export interface LoginState {
  readonly error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const accessKey = process.env.OMNIOS_ACCESS_KEY;
  if (!accessKey) {
    // No key configured means the gate is open; the login page should never
    // have been reached. Send the founder home rather than inventing a check.
    redirect('/');
  }

  if (!limiter.allow()) {
    return { error: 'Too many attempts — wait a minute and try again.' };
  }

  const submitted = formData.get('key');
  if (typeof submitted !== 'string' || submitted.length === 0) {
    return { error: 'Enter the access key.' };
  }
  if (!safeEqual(submitted, accessKey)) {
    return { error: 'That is not the access key.' };
  }

  const token = await issueToken(await deriveSessionKey(accessKey));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });

  const next = formData.get('next');
  redirect(safeNextPath(typeof next === 'string' ? next : null));
}
