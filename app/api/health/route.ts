import { NextResponse } from 'next/server';

import { safeEqual } from '@/lib/secrets/vault';
import { SESSION_COOKIE, deriveSessionKey, verifyToken } from '@/lib/auth/token';
import { getWorkspace, saveWorkspace } from '@/lib/data/store';

export const dynamic = 'force-dynamic';

/**
 * The heartbeat's landing pad.
 *
 * Exempt from the proxy and self-authenticating, exactly like the Telegram
 * webhook: the 12-hour heartbeat script presents the access key in a header
 * and needs no cookie dance; a logged-in browser's cookie works too. An
 * unauthorised request gets a bare 401 — no body, no version, no hint that
 * anything lives here. With no access key configured the gate is open by
 * definition, and the route says so honestly instead of pretending to check.
 */

function cookieValue(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

export async function GET(request: Request): Promise<Response> {
  const accessKey = process.env.OMNIOS_ACCESS_KEY;
  const at = new Date().toISOString();

  if (!accessKey) {
    return NextResponse.json({ ok: true, at, auth: 'off' });
  }

  const header = request.headers.get('x-omnios-health-key');
  const viaHeader = header !== null && safeEqual(header, accessKey);
  const viaCookie =
    !viaHeader && (await verifyToken(await deriveSessionKey(accessKey), cookieValue(request)));
  if (!viaHeader && !viaCookie) {
    return new NextResponse(null, { status: 401 });
  }

  await saveWorkspace((root) => ({ ...root, lastHeartbeatAt: at }));
  const workspace = await getWorkspace();
  return NextResponse.json({ ok: true, at, version: workspace.version });
}
