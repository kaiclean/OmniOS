'use client';

import { useActionState, useState } from 'react';

import { resetToEmptyWorkspace, type ResetState } from '@/lib/actions/settings';

const INITIAL: ResetState = { ok: false };
const PHRASE = 'RESET';

export interface ResetWorkspaceProps {
  /** Exactly what disappears, counted from the store — never a rounded reassurance. */
  losses: ReadonlyArray<{ label: string; detail: string }>;
  survives: readonly string[];
  location: string;
}

/**
 * The only irreversible action in OmniOS.
 *
 * Three things guard it, and all three are deliberate: the founder reads a list
 * of what will actually be deleted, counted from their own store rather than
 * described in general terms; they type the word; and the button stays disabled
 * until they have. The server checks the word again, because a disabled button
 * is a courtesy, not a control.
 */
export function ResetWorkspace({ losses, survives, location }: ResetWorkspaceProps) {
  const [state, action, pending] = useActionState(resetToEmptyWorkspace, INITIAL);
  const [confirm, setConfirm] = useState('');
  const armed = confirm.trim() === PHRASE;

  return (
    <form action={action} className="stack">
      <p className="prose">
        This replaces everything below with an empty workspace: no companies, no records, no
        conversation, and no shared knowledge. It is how you leave the sample workspace behind once
        your own spaces exist. There is no undo and no export step — copy{' '}
        <span className="mono">{location}</span> first if any of it matters.
      </p>

      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <span className="eyebrow">Deleted</span>
        <div className="list">
          {losses.map((loss) => (
            <div key={loss.label} className="list-row">
              <div className="grow">
                <div className="list-primary">{loss.label}</div>
                <div className="list-secondary">{loss.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <span className="eyebrow">Kept</span>
        <ul className="stack" style={{ gap: 'var(--s-1)' }}>
          {survives.map((item) => (
            <li key={item} className="hint">
              · {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="field">
        <label className="label" htmlFor="confirm">
          Type {PHRASE} to confirm
        </label>
        <input
          className="input"
          id="confirm"
          name="confirm"
          value={confirm}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setConfirm(event.target.value)}
          aria-describedby="confirm-hint"
        />
        <span className="hint" id="confirm-hint">
          Capitals, exactly. The server checks this again before deleting anything.
        </span>
      </div>

      {state.error ? (
        <p className="note note--warn" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="spread">
        <span className="hint">
          {pending ? 'Emptying the workspace…' : 'You will land back on the home screen.'}
        </span>
        <button className="btn btn--danger" type="submit" disabled={!armed || pending}>
          Reset to an empty workspace
        </button>
      </div>
    </form>
  );
}
