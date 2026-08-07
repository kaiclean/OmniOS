import 'server-only';

/**
 * The Telegram transport.
 *
 * Deliberately thin and deliberately not a tool. Every outward capability in
 * OmniOS is a `ToolDefinition` behind the gate — this one is not, and the reason
 * is worth stating rather than leaving to be inferred: this is the *channel the
 * gate speaks through*. Routing it through the gate would mean an approval
 * request needed an approval to be sent, which is a deadlock, not a safeguard.
 *
 * What that costs is real and bounded: the founder configures one chat id, and
 * the only thing this module can ever send there is an approval request or its
 * outcome. It cannot be aimed by a model, it takes no free-text destination, and
 * `sendApprovalRequest` is its whole vocabulary.
 */

import { revealSecret } from '@/lib/secrets/vault';

const API = 'https://api.telegram.org';
const BOT_TOKEN = 'TELEGRAM_BOT_TOKEN';

export interface TelegramButton {
  readonly text: string;
  readonly callbackData: string;
}

export interface TelegramSendResult {
  readonly ok: boolean;
  readonly messageId?: number;
  readonly error?: string;
}

async function botToken(): Promise<string | null> {
  const stored = await revealSecret(BOT_TOKEN);
  if (stored?.trim()) return stored.trim();
  const fromEnv = process.env[BOT_TOKEN];
  return fromEnv?.trim() ? fromEnv.trim() : null;
}

export async function telegramConfigured(): Promise<boolean> {
  return (await botToken()) !== null;
}

async function call(method: string, body: Record<string, unknown>): Promise<TelegramSendResult> {
  const token = await botToken();
  if (!token) return { ok: false, error: `No ${BOT_TOKEN} stored.` };

  try {
    const response = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!response.ok || !payload.ok) {
      // Telegram's own description, not the raw body: a failed call must not put
      // anything from the request — which contains the bot path — into a record.
      return { ok: false, error: payload.description ?? `HTTP ${response.status}` };
    }
    return { ok: true, ...(payload.result?.message_id ? { messageId: payload.result.message_id } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Telegram was unreachable.' };
  }
}

export async function sendMessage(
  chatId: string,
  text: string,
  buttons: readonly TelegramButton[] = [],
): Promise<TelegramSendResult> {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    // No parse mode. A preview is founder data — a stray underscore in a task
    // title should not silently become italics, and worse, a crafted title
    // should not be able to inject markup into an approval prompt.
    ...(buttons.length > 0
      ? {
          reply_markup: {
            inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.callbackData }))],
          },
        }
      : {}),
  });
}

/** Replaces the buttons with the outcome, so a decided request cannot be re-pressed. */
export async function resolveMessage(
  chatId: string,
  messageId: number,
  text: string,
): Promise<TelegramSendResult> {
  return call('editMessageText', { chat_id: chatId, message_id: messageId, text });
}

/** Stops Telegram's spinner. Best-effort: a failure here changes no decision. */
export async function answerCallback(callbackQueryId: string, text: string): Promise<void> {
  await call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}
