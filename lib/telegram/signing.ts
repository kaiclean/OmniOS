/**
 * Authenticating a decision that arrives from outside the machine.
 *
 * The approval gate's whole claim is that a gated call runs only against a
 * recorded *human* decision. A Telegram button is a decision arriving over an
 * open network from a service OmniOS does not control, so the claim survives
 * only if a callback that did not originate from the founder's own chat cannot
 * move a call. Two independent properties, both enforced here:
 *
 * 1. **Unforgeable.** The callback carries an HMAC over the decision, the call
 *    id and the chat id. Without the workspace's signing key you cannot mint one.
 * 2. **Chat-bound.** The chat id is *inside* the signature, and verification
 *    recomputes it against the chat the callback actually arrived from. So a
 *    valid button, forwarded or replayed into another chat, verifies against the
 *    wrong chat id and fails — being an allowed chat is not enough, it must be
 *    the chat the request was sent to. This is the property OmniDash's
 *    `telegram-hardening` tests exist to protect, reached here without state.
 *
 * Stateless on purpose: there is no pending-nonce table to keep in step with the
 * ToolCall collection, and therefore no window where the two disagree. Replay
 * inside the *right* chat is handled a layer up, where `approveToolCall` refuses
 * anything that is no longer `awaiting-approval`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Telegram caps `callback_data` at 64 bytes, so the signature is truncated. */
const SIGNATURE_CHARS = 22;

export type ApprovalDecision = 'approve' | 'reject';

/** `a` and `r` rather than the words: every byte counts against the 64-byte cap. */
const DECISION_CODE: Record<ApprovalDecision, string> = { approve: 'a', reject: 'r' };
const DECISION_BY_CODE: Record<string, ApprovalDecision> = { a: 'approve', r: 'reject' };

export interface ApprovalCallback {
  readonly decision: ApprovalDecision;
  readonly toolCallId: string;
}

function signature(key: string, decision: ApprovalDecision, toolCallId: string, chatId: string): string {
  return createHmac('sha256', key)
    .update(`${decision}|${toolCallId}|${chatId}`)
    .digest('base64url')
    .slice(0, SIGNATURE_CHARS);
}

/**
 * The `callback_data` for one button.
 *
 * Throws rather than truncating if it would exceed Telegram's limit: a silently
 * clipped payload would fail verification later and look like an attack.
 */
export function signApprovalCallback(
  key: string,
  decision: ApprovalDecision,
  toolCallId: string,
  chatId: string,
): string {
  const data = `${DECISION_CODE[decision]}:${toolCallId}:${signature(key, decision, toolCallId, chatId)}`;
  if (Buffer.byteLength(data, 'utf8') > 64) {
    throw new Error(`callback_data for ${toolCallId} exceeds Telegram's 64-byte limit`);
  }
  return data;
}

/**
 * Verify a callback against the chat it actually came from.
 *
 * Returns `null` for anything that does not check out — malformed, unknown
 * decision, bad signature, or right signature but wrong chat. The caller is
 * expected to treat every `null` identically and say nothing useful back: a
 * response that distinguished "bad signature" from "unknown call" would confirm
 * which call ids exist to anyone holding the bot token.
 */
export function verifyApprovalCallback(
  key: string,
  data: string,
  chatId: string,
): ApprovalCallback | null {
  const parts = data.split(':');
  if (parts.length !== 3) return null;

  const [code, toolCallId, presented] = parts;
  const decision = code ? DECISION_BY_CODE[code] : undefined;
  if (!decision || !toolCallId || !presented) return null;

  // Recomputed with the *incoming* chat id, which is what binds the button to
  // one conversation rather than to the bot as a whole.
  const expected = signature(key, decision, toolCallId, chatId);
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { decision, toolCallId };
}
