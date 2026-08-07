'use client';

import { useActionState, useState, useTransition } from 'react';

import type { SecretKind, SecretMeta } from '@/lib/domain';
import { SECRET_KINDS } from '@/lib/domain';
import { formatRelative, pluralise } from '@/lib/format';
import { forgetSecret, saveSecret, type SecretFormState } from '@/lib/actions/secrets';
import { Badge, Empty } from '@/components/ui/primitives';

const INITIAL: SecretFormState = { ok: false };

const KIND_LABELS: Readonly<Record<SecretKind, string>> = {
  'api-key': 'API key',
  token: 'Token',
  password: 'Password',
  'connection-string': 'Connection string',
  'account-number': 'Account number',
  note: 'Note',
};

/**
 * The vault, as far as the browser is concerned.
 *
 * Values travel in one direction only. This component can create a secret and
 * forget one; there is no control that reveals a stored value, and no action
 * exists that would return one, because a value that can reach a browser is a
 * value that can reach a screenshot, a log and a bug report.
 */
export function SecretsPanel({
  secrets,
  suggestions,
  keySource,
  location,
  algorithm,
}: {
  secrets: readonly SecretMeta[];
  /** Names something in the workspace is already asking for. */
  suggestions: readonly { name: string; wantedBy: string }[];
  keySource: string;
  location: string;
  algorithm: string;
}) {
  const [state, action, pending] = useActionState(saveSecret, INITIAL);
  const [name, setName] = useState('');
  const [removing, startTransition] = useTransition();

  const stored = new Set(secrets.map((secret) => secret.name));
  const missing = suggestions.filter((suggestion) => !stored.has(suggestion.name));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      {missing.length > 0 ? (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <span className="eyebrow">Asked for, not yet stored</span>
          <div className="chip-row">
            {missing.map((suggestion) => (
              <button
                key={suggestion.name}
                className="btn btn--ghost mono"
                type="button"
                onClick={() => setName(suggestion.name)}
              >
                {suggestion.name}
              </button>
            ))}
          </div>
          <span className="hint">
            {missing.map((suggestion) => `${suggestion.name} — ${suggestion.wantedBy}`).join(' · ')}
          </span>
        </div>
      ) : null}

      <form action={action} className="stack">
        <div className="two-up">
          <div className="field">
            <label className="label" htmlFor="secret-name">
              Name
            </label>
            <input
              className="input mono"
              id="secret-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ANTHROPIC_API_KEY"
              aria-invalid={state.errors?.name ? true : undefined}
            />
            {state.errors?.name ? (
              <span className="hint delta--bad" role="alert">
                {state.errors.name}
              </span>
            ) : (
              <span className="hint">
                How you will reference it: <span className="mono">{`{{secret:${name || 'NAME'}}}`}</span>
              </span>
            )}
          </div>

          <div className="field">
            <label className="label" htmlFor="secret-kind">
              Kind
            </label>
            <select className="select" id="secret-kind" name="kind" defaultValue="api-key">
              {SECRET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
            <span className="hint">Organisational only. Everything is encrypted the same way.</span>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="secret-value">
            Value
          </label>
          <input
            className="input mono"
            id="secret-value"
            name="value"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={state.errors?.value ? true : undefined}
          />
          {state.errors?.value ? (
            <span className="hint delta--bad" role="alert">
              {state.errors.value}
            </span>
          ) : (
            <span className="hint">
              Encrypted with {algorithm} before it touches the disk, and never returned to this
              page afterwards. Storing the same name again replaces the value.
            </span>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="secret-description">
            What it is for
          </label>
          <input
            className="input"
            id="secret-description"
            name="description"
            maxLength={140}
            placeholder="Publishing to the brand account"
          />
        </div>

        <div className="spread">
          <span className="hint" role="status">
            {pending ? 'Encrypting…' : (state.message ?? `${pluralise(secrets.length, 'secret')} stored.`)}
          </span>
          <button className="btn btn--primary" type="submit" disabled={pending}>
            Store secret
          </button>
        </div>
      </form>

      <div className="divider" />

      {secrets.length === 0 ? (
        <Empty title="Nothing stored yet">
          Keys added here are available to every connection and to the assistant’s tools, always as
          a placeholder rather than a value.
        </Empty>
      ) : (
        <div className="list">
          {secrets.map((secret) => (
            <div key={secret.name} className="list-row">
              <div className="grow">
                <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
                  <span className="list-primary mono">{secret.name}</span>
                  <Badge tone="outline">{KIND_LABELS[secret.kind]}</Badge>
                  <span className="hint mono">{secret.hint}</span>
                </div>
                <div className="list-secondary">
                  {secret.description || 'No description.'} · updated{' '}
                  {formatRelative(secret.updatedAt)} ·{' '}
                  {secret.useCount === 0
                    ? 'never used'
                    : `used ${pluralise(secret.useCount, 'time')}${secret.lastUsedAt ? `, last ${formatRelative(secret.lastUsedAt)}` : ''}`}
                </div>
              </div>
              <div className="list-meta">
                <button
                  className="btn btn--ghost"
                  type="button"
                  disabled={removing}
                  onClick={() => startTransition(() => void forgetSecret(secret.name))}
                >
                  Forget
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <span className="hint">
        The encryption key comes from the {keySource}, and the vault file lives at{' '}
        <span className="mono" style={{ overflowWrap: 'anywhere' }}>
          {location}
        </span>
        . This protects a secret in a backup, a synced folder or an accidental commit. It does not
        protect against someone who already has this machine unlocked, because the key is on the
        same disk — that is the honest trade for a local-first system with no server.
      </span>
    </div>
  );
}
