'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { askAssistant } from '@/lib/actions/assistant';

/**
 * The founder-mode composer.
 *
 * Deliberately thinner than the sidebar copilot: it holds no message list of its
 * own. The page is a Server Component that reads the stored conversation, so a
 * turn is finished by refreshing that tree rather than by keeping a second copy
 * of the history in the browser — which is how the two surfaces stay in agreement
 * about what was actually said.
 */
export function Composer({
  assistantName,
  suggestions,
}: {
  assistantName: string;
  suggestions: readonly string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setDraft('');
    start(async () => {
      const result = await askAssistant('founder', trimmed);
      if (!result.ok) {
        setError(result.error ?? 'That did not go through.');
        setDraft(trimmed);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="stack">
      <form
        className="stack"
        style={{ gap: 'var(--s-3)' }}
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="textarea"
          placeholder={`Ask ${assistantName} anything across every space you own…`}
          aria-label={`Ask ${assistantName}`}
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="spread">
          <span className="hint" role="status">
            {pending
              ? 'Routing to specialists and reading your records…'
              : 'Enter sends · Shift+Enter for a new line'}
          </span>
          <button className="btn btn--primary" type="submit" disabled={pending || !draft.trim()}>
            {pending ? 'Working…' : 'Ask'}
          </button>
        </div>
      </form>

      {error ? (
        <p className="note note--warn" role="alert">
          {error}
        </p>
      ) : null}

      <div className="chip-row">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={pending}
            onClick={() => send(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
