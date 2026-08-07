import { handleApprovalCallback } from '@/lib/telegram/approvals';

/**
 * Where Telegram delivers a button press.
 *
 * The only unauthenticated route in OmniOS, so it is written as if the whole
 * internet can reach it — which, once a webhook is registered, it can. Three
 * independent gates stand between a POST here and a `destructive` call running:
 *
 * 1. **The shared secret.** Telegram echoes `TELEGRAM_WEBHOOK_SECRET` back in a
 *    header on every delivery. Anything without it is not from Telegram.
 * 2. **The signature.** The callback carries an HMAC over decision, call id and
 *    chat id, checked in `verifyApprovalCallback` against the chat it arrived
 *    from. Holding the bot token is not enough to mint one.
 * 3. **The gate itself.** The decision goes through the same
 *    `approveToolCallAs` the in-app buttons use, which refuses anything not
 *    still `awaiting-approval`.
 *
 * The response is always 200 with an empty body, whatever happened. Telegram
 * retries on a non-2xx, and a body that distinguished "bad secret" from "unknown
 * call" would be an oracle for anyone probing the endpoint.
 */

export const dynamic = 'force-dynamic';

const OK = new Response(null, { status: 200 });

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  // Fail closed: with no secret configured the endpoint accepts nothing at all,
  // rather than accepting everything.
  if (!expected) return OK;
  if (request.headers.get('x-telegram-bot-api-secret-token') !== expected) return OK;

  try {
    const update = (await request.json()) as { callback_query?: unknown };
    if (update.callback_query) {
      await handleApprovalCallback(update.callback_query as Parameters<typeof handleApprovalCallback>[0]);
    }
  } catch {
    // A malformed body is noise, not an incident. Nothing was decided.
  }

  return OK;
}
