import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, deriveSessionKey, verifyToken } from '@/lib/auth/token';
import { shouldProtect } from '@/lib/auth/paths';

/**
 * The access gate for remote use — deliberately thin.
 *
 * Auth is opt-in: with no `OMNIOS_ACCESS_KEY` in the environment, OmniOS
 * behaves exactly as it always has on localhost. Set the key (the tunnel
 * runbook makes it mandatory) and every page, Server Action and API — the
 * decisions live in `lib/auth/paths.ts`, where they are unit-tested — needs a
 * session cookie signed with a key derived from it.
 *
 * This runs on the edge runtime, so nothing here may touch Node APIs, the
 * store or the vault. The heavy thinking happens elsewhere; this file only
 * verifies and redirects.
 */

let cachedFor: string | undefined;
let cachedKey: Promise<CryptoKey> | undefined;

function sessionKey(accessKey: string): Promise<CryptoKey> {
  if (cachedFor !== accessKey || !cachedKey) {
    cachedFor = accessKey;
    cachedKey = deriveSessionKey(accessKey);
  }
  return cachedKey;
}

export default async function proxy(request: NextRequest) {
  const accessKey = process.env.OMNIOS_ACCESS_KEY;
  if (!accessKey) return NextResponse.next();
  if (!shouldProtect(request.nextUrl.pathname)) return NextResponse.next();

  const key = await sessionKey(accessKey);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifyToken(key, token)) return NextResponse.next();

  // APIs get a bare 401; a browser gets the login page with a way back.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return new NextResponse(null, { status: 401 });
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
