import { describe, expect, it } from 'vitest';

import { signApprovalCallback, verifyApprovalCallback } from '@/lib/telegram/signing';

/**
 * The remote decision channel.
 *
 * A Telegram button approves a `destructive` or `external` call, so this is the
 * one place where the approval gate's "recorded human decision" arrives over an
 * open network. These tests exist to hold the two properties that make that
 * safe, and they are written from the attacker's side: what does someone who has
 * seen a button, or holds the bot token, manage to do?
 */

const KEY = 'workspace-signing-key-not-a-real-one';
const CHAT = '555';
const OTHER_CHAT = '777';
const CALL = 'call_dcbokgq15s';

describe('approval callbacks are unforgeable', () => {
  it('round-trips a decision the workspace itself signed', () => {
    for (const decision of ['approve', 'reject'] as const) {
      const data = signApprovalCallback(KEY, decision, CALL, CHAT);
      expect(verifyApprovalCallback(KEY, data, CHAT)).toEqual({ decision, toolCallId: CALL });
    }
  });

  it('refuses a callback minted with a different key', () => {
    const forged = signApprovalCallback('some-other-key', 'approve', CALL, CHAT);
    expect(verifyApprovalCallback(KEY, forged, CHAT)).toBeNull();
  });

  it('refuses hand-written callback data', () => {
    for (const data of [
      `a:${CALL}:`,
      `a:${CALL}:aaaaaaaaaaaaaaaaaaaaaa`,
      `a:${CALL}`,
      `x:${CALL}:whatever`,
      `a::sig`,
      '',
      'a:b:c:d',
    ]) {
      expect(verifyApprovalCallback(KEY, data, CHAT), data).toBeNull();
    }
  });

  it('will not let an approve signature be replayed as a reject', () => {
    // The decision is inside the HMAC, so the two buttons are not interchangeable
    // — swapping the prefix on a captured approval does not produce a rejection,
    // and more importantly the reverse does not produce an approval.
    const reject = signApprovalCallback(KEY, 'reject', CALL, CHAT);
    const swapped = `a:${reject.split(':').slice(1).join(':')}`;
    expect(verifyApprovalCallback(KEY, swapped, CHAT)).toBeNull();
  });

  it('will not let a signature be moved to another call', () => {
    const data = signApprovalCallback(KEY, 'approve', CALL, CHAT);
    const moved = data.replace(CALL, 'call_someoneelse');
    expect(verifyApprovalCallback(KEY, moved, CHAT)).toBeNull();
  });
});

describe('approval callbacks are bound to one chat', () => {
  /**
   * The property OmniDash's hardening tests were written to protect, restated:
   * a chat being *allowed* is not the same as being *the* chat. A button offered
   * in the founder's private chat must not be answerable from a group the bot
   * also happens to sit in — even though that group passes every allowlist.
   */
  it('refuses a genuine button replayed from a different chat', () => {
    const data = signApprovalCallback(KEY, 'approve', CALL, CHAT);
    expect(verifyApprovalCallback(KEY, data, CHAT)).not.toBeNull();
    expect(verifyApprovalCallback(KEY, data, OTHER_CHAT)).toBeNull();
  });

  it('signs differently for every chat, so one button never fits two', () => {
    const a = signApprovalCallback(KEY, 'approve', CALL, CHAT);
    const b = signApprovalCallback(KEY, 'approve', CALL, OTHER_CHAT);
    expect(a).not.toBe(b);
  });
});

describe('callback data fits the transport', () => {
  it('stays inside Telegram’s 64-byte limit for a real call id', () => {
    const data = signApprovalCallback(KEY, 'approve', CALL, CHAT);
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('throws rather than silently clipping an id that would not fit', () => {
    // A truncated payload would fail verification later and read as an attack,
    // which is a bug that would be diagnosed in the wrong place entirely.
    expect(() => signApprovalCallback(KEY, 'approve', 'call_'.padEnd(60, 'x'), CHAT)).toThrow(
      /64-byte limit/,
    );
  });
});
