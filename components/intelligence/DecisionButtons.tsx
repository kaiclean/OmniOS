'use client';

import { useState, useTransition } from 'react';

import { decideUpgrade, reopenUpgrade } from '@/lib/actions/intelligence';

/**
 * The founder gate.
 *
 * Three buttons and a note, and no fourth button that says "apply". The reason
 * this is a client component at all is the note field and the pending state: a
 * decision that silently succeeds is indistinguishable from one that silently
 * failed, and this is the one interaction in the product where that matters.
 */
const CHOICES = [
  {
    kind: 'approve',
    label: 'Approve',
    className: 'btn btn--primary',
    hint: 'Records that you want this change. It does not make it.',
  },
  {
    kind: 'reject',
    label: 'Reject',
    className: 'btn btn--danger',
    hint: 'Closes the candidate, with your reason kept alongside it.',
  },
  {
    kind: 'test-longer',
    label: 'Test longer',
    className: 'btn btn--secondary',
    hint: 'Sends it back for more trials before you decide.',
  },
] as const;

export function DecisionButtons({ candidateId }: { candidateId: string }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (kind: string) => {
    setError(null);
    setChosen(kind);
    startTransition(async () => {
      const result = await decideUpgrade(candidateId, kind, note);
      if (result.ok) setNote('');
      else setError(result.error ?? 'That decision could not be recorded.');
      setChosen(null);
    });
  };

  const noteId = `decision-note-${candidateId}`;

  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      <div className="field">
        <label className="label" htmlFor={noteId}>
          Why <span className="faint">· optional, stored with the decision</span>
        </label>
        <textarea
          className="textarea"
          id={noteId}
          name="note"
          value={note}
          maxLength={600}
          onChange={(event) => setNote(event.target.value)}
          placeholder="The reasoning you will want to read back in three months."
        />
      </div>

      <div className="row wrap">
        {CHOICES.map((choice) => (
          <button
            key={choice.kind}
            type="button"
            className={choice.className}
            disabled={pending}
            title={choice.hint}
            onClick={() => decide(choice.kind)}
          >
            {pending && chosen === choice.kind ? 'Recording…' : choice.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="hint delta--bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Returns a decided candidate to the queue. Never available once applied. */
export function ReopenButton({ candidateId }: { candidateId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="row wrap">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await reopenUpgrade(candidateId);
            if (!result.ok) setError(result.error ?? 'That candidate could not be reopened.');
          });
        }}
      >
        {pending ? 'Reopening…' : 'Reopen for decision'}
      </button>
      {error ? (
        <span className="hint delta--bad" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
