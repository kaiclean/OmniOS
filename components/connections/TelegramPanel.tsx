'use client';

import { useActionState, useState, useTransition } from 'react';

import type { RiskTier, TelegramConfig } from '@/lib/domain';
import { RISK_EXPLANATION } from '@/lib/domain';
import { saveTelegramConfig, sendTelegramTest, type TelegramFormState } from '@/lib/actions/telegram';
import { Badge } from '@/components/ui/primitives';

const INITIAL: TelegramFormState = { ok: false };

/** Only the tiers that stop and wait can be worth a notification. */
const NOTIFIABLE: readonly RiskTier[] = ['write', 'destructive', 'external'];

/**
 * Approvals on a phone.
 *
 * The copy here does the work the UI cannot: it says plainly that this is a
 * second door onto the same inbox, that the token is a credential and lives in
 * the vault, and that a button is bound to one chat. A founder arming a remote
 * approval channel should know exactly what they have widened.
 */
export function TelegramPanel({
  config,
  tokenStored,
  webhookSecretSet,
}: {
  config: TelegramConfig;
  tokenStored: boolean;
  webhookSecretSet: boolean;
}) {
  const [state, action, pending] = useActionState(saveTelegramConfig, INITIAL);
  const [testing, startTest] = useTransition();
  // The test action's result was voided, so a successful "Sent" produced no
  // feedback and a failure showed nothing either — the founder could not tell
  // whether the link worked. Hold it and render it in the feedback slots.
  const [testResult, setTestResult] = useState<TelegramFormState | null>(null);

  const ready = tokenStored && webhookSecretSet;

  return (
    <form action={action} className="stack">
      <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
        <Badge tone={config.enabled ? 'outline' : 'warn'}>{config.enabled ? 'armed' : 'off'}</Badge>
        <Badge tone={tokenStored ? 'outline' : 'warn'}>
          {tokenStored ? 'token in vault' : 'no token'}
        </Badge>
        <Badge tone={webhookSecretSet ? 'outline' : 'warn'}>
          {webhookSecretSet ? 'webhook secret set' : 'no webhook secret'}
        </Badge>
      </div>

      <p className="prose">
        A second door onto the approvals inbox, not a wider one. Only the tiers you pick are sent,
        each button is signed and bound to this one chat, and the decision goes through the same gate
        the in-app buttons use — recorded against the chat that pressed it, not against you.
      </p>

      {!ready ? (
        <p className="note note--warn">
          Two things first: store <span className="mono">TELEGRAM_BOT_TOKEN</span> in Keys and
          secrets below — it is a credential and belongs in the vault, not on this form — and set{' '}
          <span className="mono">TELEGRAM_WEBHOOK_SECRET</span> in your environment. Without the
          secret the webhook rejects every delivery, so the buttons would arrive and do nothing.
        </p>
      ) : null}

      <label className="check-chip">
        <input type="checkbox" name="enabled" defaultChecked={config.enabled} disabled={!ready} />
        Send approval requests to Telegram
      </label>

      <div className="field">
        <label className="label" htmlFor="chatId">
          Chat id
        </label>
        <input
          className="input"
          id="chatId"
          name="chatId"
          inputMode="numeric"
          placeholder="123456789"
          defaultValue={config.chatId}
        />
        <span className="hint">
          One chat, deliberately. A request offered here is answerable only from here — a second
          entry would be a second place a destructive call could be authorised from.
        </span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <span className="label">Which tiers to send</span>
        <div className="chip-row">
          {NOTIFIABLE.map((tier) => (
            <label key={tier} className="check-chip" title={RISK_EXPLANATION[tier]}>
              <input
                type="checkbox"
                name="notifyRisk"
                value={tier}
                defaultChecked={config.notifyRisk.includes(tier)}
              />
              {tier}
            </label>
          ))}
        </div>
        <span className="hint">
          Destructive and external stop and wait anyway. Adding write means a notification for every
          record the assistant creates — which is how an approval prompt stops being read.
        </span>
      </div>

      {config.lastError ? (
        <p className="note note--warn">Last attempt failed: {config.lastError}</p>
      ) : null}
      {state.error ? <p className="note note--warn">{state.error}</p> : null}
      {state.ok && state.message ? (
        <span className="hint" role="status">
          {state.message}
        </span>
      ) : null}
      {testResult?.error ? <p className="note note--warn">Test failed: {testResult.error}</p> : null}
      {testResult?.ok ? (
        <span className="hint" role="status">
          {testResult.message ?? 'Sent. Check your phone.'}
        </span>
      ) : null}

      <div className="row" style={{ gap: 'var(--s-2)' }}>
        <button className="btn btn--primary btn--sm" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={testing || !config.chatId}
          onClick={() => startTest(async () => setTestResult(await sendTelegramTest()))}
        >
          {testing ? 'Sending…' : 'Send a test message'}
        </button>
      </div>
    </form>
  );
}
