import 'server-only';

/**
 * The approval gate, reachable from a phone.
 *
 * Nothing here decides anything. It carries a `ToolCall` that is already
 * `awaiting-approval` out to one chat, and carries a verified answer back into
 * `lib/approvals/decide.ts` — the same function the in-app buttons call, with a
 * different decider recorded. A call that never reached `awaiting-approval` is
 * not reachable from Telegram at all, because the only ids that ever leave this
 * machine are the ones the gate already stopped.
 */

import type { Scope, ToolCall } from '@/lib/domain';
import { RISK_EXPLANATION, parseScopeKey, scopeKey, telegramDecider } from '@/lib/domain';
import { getWorkspace, saveWorkspace } from '@/lib/data/store';
import { approveToolCallAs, findToolCall, rejectToolCallAs } from '@/lib/approvals/decide';
import { deriveSubkey } from '@/lib/secrets/vault';
import { answerCallback, resolveMessage, sendMessage } from './client';
import { signApprovalCallback, verifyApprovalCallback } from './signing';

const SIGNING_PURPOSE = 'telegram-approval';

/**
 * Ask the founder, on their phone.
 *
 * Best-effort by design: a Telegram outage must never stop a call being queued,
 * because the approvals inbox in the app is the source of truth and this is a
 * second door onto it. A failure is recorded on the config so a channel that has
 * gone quiet is visible rather than assumed to be working.
 */
export async function notifyPendingCall(call: ToolCall, spaceLabel: string): Promise<void> {
  const workspace = await getWorkspace();
  const config = workspace.telegram;
  if (!config.enabled || !config.chatId) return;
  if (!config.notifyRisk.includes(call.risk)) return;

  const key = await deriveSubkey(SIGNING_PURPOSE);
  const text = [
    `${spaceLabel} — approval needed`,
    '',
    call.preview,
    '',
    `${call.risk.toUpperCase()}: ${RISK_EXPLANATION[call.risk]}`,
  ].join('\n');

  const result = await sendMessage(config.chatId, text, [
    { text: 'Approve', callbackData: signApprovalCallback(key, 'approve', call.id, config.chatId) },
    { text: 'Reject', callbackData: signApprovalCallback(key, 'reject', call.id, config.chatId) },
  ]);

  await saveWorkspace((root) => ({
    ...root,
    telegram: {
      ...root.telegram,
      lastNotifiedAt: new Date().toISOString(),
      ...(result.ok ? { lastError: undefined } : { lastError: result.error ?? 'unknown' }),
    },
  }));
}

interface CallbackQuery {
  readonly id?: string;
  readonly data?: string;
  readonly message?: { readonly message_id?: number; readonly chat?: { readonly id?: number | string } };
}

/**
 * Apply a decision that arrived from Telegram.
 *
 * Every rejection path returns quietly and identically. Telling a caller *why*
 * their callback failed would confirm which call ids exist to anyone holding the
 * bot token, and the founder — who sees only working buttons — learns nothing
 * from the distinction.
 */
export async function handleApprovalCallback(query: CallbackQuery): Promise<void> {
  const data = query.data;
  const chatId = query.message?.chat?.id;
  if (!data || chatId === undefined) return;

  const workspace = await getWorkspace();
  const config = workspace.telegram;
  if (!config.enabled || !config.chatId) return;

  // A coarse first filter. The signature below is what actually binds the button
  // to this chat — this only avoids the work for obvious noise.
  const incomingChat = String(chatId);
  if (incomingChat !== config.chatId) return;

  const key = await deriveSubkey(SIGNING_PURPOSE);
  const verified = verifyApprovalCallback(key, data, incomingChat);
  if (!verified) return;

  const found = await locateCall(verified.toolCallId);
  if (!found) return;

  const decider = telegramDecider(incomingChat);
  const outcome =
    verified.decision === 'approve'
      ? (await approveToolCallAs(found.scope, verified.toolCallId, decider)).summary
      : (await rejectToolCallAs(found.scope, verified.toolCallId, decider))
        ? 'Rejected. Nothing ran.'
        : 'That call was already decided.';

  // Replace the buttons with the outcome so the same request cannot be pressed
  // twice — `decideToolCall` would refuse anyway, but a live button that does
  // nothing is worse than no button.
  const messageId = query.message?.message_id;
  if (messageId) {
    await resolveMessage(incomingChat, messageId, `${found.call.preview}\n\n→ ${outcome}`);
  }
  if (query.id) await answerCallback(query.id, outcome.slice(0, 200));
}

/**
 * Find a pending call by id, across the spaces the founder owns.
 *
 * Scoped reads only — there is no `readEverything()` here either. This walks the
 * same list `pendingApprovals()` does, for the same reason: it is the founder's
 * own inbox, assembled for their own question.
 */
async function locateCall(
  toolCallId: string,
): Promise<{ readonly scope: Scope; readonly call: ToolCall } | null> {
  const workspace = await getWorkspace();
  const keys = [
    ...workspace.companies.filter((company) => !company.archivedAt).map((company) => `company:${company.id}`),
    'personal',
  ];

  for (const key of keys) {
    const scope = parseScopeKey(key);
    if (!scope || scope.kind === 'shared') continue;
    const call = await findToolCall(scope, toolCallId);
    if (call) return { scope, call };
  }
  return null;
}

/** For the Connections page: what the founder would need to finish linking. */
export async function telegramLinkState(): Promise<{
  readonly enabled: boolean;
  readonly chatId: string;
  readonly lastError: string | null;
}> {
  const { telegram } = await getWorkspace();
  return {
    enabled: telegram.enabled,
    chatId: telegram.chatId,
    lastError: telegram.lastError ?? null,
  };
}

export { scopeKey };
