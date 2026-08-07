/**
 * The remote decision channel, as configuration.
 *
 * Pure and client-safe: the Settings page renders this, and nothing here can
 * reach a token. The bot token itself lives in the vault under
 * `TELEGRAM_BOT_TOKEN` and never appears on this record — what is stored is
 * which conversation may decide, not what may talk to Telegram.
 */

import type { RiskTier } from './tools';
import type { Timestamp } from './work';

export interface TelegramConfig {
  readonly enabled: boolean;
  /**
   * The one conversation that may decide. Not a list: an approval is offered to
   * a chat and answerable only from that chat, so a second entry would be a
   * second place a `destructive` call could be authorised from.
   */
  readonly chatId: string;
  /**
   * Which tiers are worth interrupting someone for. Defaults to the two that
   * stop and wait anyway — a `write` notification would be noise, and noise is
   * how an approval prompt stops being read.
   */
  readonly notifyRisk: readonly RiskTier[];
  readonly linkedAt?: Timestamp;
  /** Last error from Telegram, so a silent channel is visible rather than assumed. */
  readonly lastError?: string;
  readonly lastNotifiedAt?: Timestamp;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
  chatId: '',
  notifyRisk: ['destructive', 'external'],
};

/** A chat id is an integer, possibly negative for a group. Nothing else. */
export function isValidChatId(value: string): boolean {
  return /^-?\d{1,20}$/.test(value.trim());
}

/**
 * Who decided, written down.
 *
 * `ACTOR = 'founder'` was true while the app was the only way to answer. A
 * remote channel makes "who authorised this" a real question, so the answer
 * becomes part of the record rather than an assumption baked into a constant.
 */
export function telegramDecider(chatId: string): string {
  return `telegram:${chatId}`;
}
