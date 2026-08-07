'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { RISK_TIERS, isValidChatId } from '@/lib/domain';
import { getWorkspace, saveWorkspace } from '@/lib/data/store';
import { hasSecret } from '@/lib/secrets/vault';
import { sendMessage } from '@/lib/telegram/client';

/**
 * Linking the remote decision channel.
 *
 * Note what this action does *not* accept: a bot token. The token is a
 * credential and goes into the vault through the ordinary secrets form, so it
 * never travels through a form submission that also carries display state, and
 * never lands on the workspace root where a page prop could pick it up.
 */

const Config = z.object({
  enabled: z.boolean(),
  chatId: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidChatId(value), {
      message: 'A chat id is a number — get yours by messaging the bot and opening /getUpdates.',
    }),
  notifyRisk: z.array(z.enum(RISK_TIERS)).min(1, 'Pick at least one tier, or turn the channel off.'),
});

export interface TelegramFormState {
  readonly ok: boolean;
  readonly message?: string;
  readonly error?: string;
}

export async function saveTelegramConfig(
  _previous: TelegramFormState,
  form: FormData,
): Promise<TelegramFormState> {
  const enabled = form.get('enabled') === 'on';
  const parsed = Config.safeParse({
    enabled,
    chatId: String(form.get('chatId') ?? ''),
    notifyRisk: form.getAll('notifyRisk').map(String),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That did not validate.' };
  }

  // Refusing to arm a channel that cannot speak is not pedantry: a founder who
  // believes approvals reach their phone, and is wrong, waits for a prompt that
  // never comes while a call sits queued.
  if (parsed.data.enabled) {
    if (!parsed.data.chatId) {
      return { ok: false, error: 'A chat id is required before the channel can be turned on.' };
    }
    if (!(await hasSecret('TELEGRAM_BOT_TOKEN')) && !process.env.TELEGRAM_BOT_TOKEN) {
      return { ok: false, error: 'Store TELEGRAM_BOT_TOKEN in the vault first — it is a credential.' };
    }
    if (!process.env.TELEGRAM_WEBHOOK_SECRET?.trim()) {
      return {
        ok: false,
        error:
          'Set TELEGRAM_WEBHOOK_SECRET before arming this. Without it the webhook rejects every delivery, so buttons would appear and do nothing.',
      };
    }
  }

  await saveWorkspace((root) => ({
    ...root,
    telegram: {
      ...root.telegram,
      enabled: parsed.data.enabled,
      chatId: parsed.data.chatId,
      notifyRisk: parsed.data.notifyRisk,
      ...(parsed.data.enabled && !root.telegram.linkedAt
        ? { linkedAt: new Date().toISOString() }
        : {}),
    },
  }));

  revalidatePath('/', 'layout');
  return { ok: true, message: parsed.data.enabled ? 'Channel armed.' : 'Channel off.' };
}

/**
 * Prove the channel works before trusting it with a decision.
 *
 * Sends a plain message with no buttons — nothing here can approve anything, so
 * a test that succeeded and a decision that could be forged stay separate.
 */
export async function sendTelegramTest(): Promise<TelegramFormState> {
  const { telegram } = await getWorkspace();
  if (!telegram.chatId) return { ok: false, error: 'No chat id configured.' };

  const result = await sendMessage(
    telegram.chatId,
    'OmniOS is linked. Approval requests for destructive and external calls will arrive here.',
  );

  await saveWorkspace((root) => ({
    ...root,
    telegram: {
      ...root.telegram,
      ...(result.ok ? { lastError: undefined } : { lastError: result.error ?? 'unknown' }),
    },
  }));

  revalidatePath('/', 'layout');
  return result.ok
    ? { ok: true, message: 'Sent. Check your phone.' }
    : { ok: false, error: result.error ?? 'Telegram refused the message.' };
}
