'use client';

import { useActionState } from 'react';

import type { LoginState } from '@/lib/actions/session';
import { login } from '@/lib/actions/session';

/**
 * One field, one button. `autocomplete="current-password"` is what lets the
 * iPhone's password manager offer to store the access key on first login —
 * the intended way to carry it.
 */
export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form className="stack" style={{ gap: 'var(--s-3)' }} action={action}>
      <input type="hidden" name="next" value={next} />
      <input
        className="input"
        type="password"
        name="key"
        placeholder="Access key"
        aria-label="Access key"
        autoComplete="current-password"
        autoFocus
        disabled={pending}
      />
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Unlock'}
      </button>
      {state.error ? (
        <p className="note note--warn" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
