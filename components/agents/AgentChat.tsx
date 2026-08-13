'use client';

import { useState, useTransition } from 'react';

import { speakToAgent } from '@/lib/actions/agents';
import { formatRelative } from '@/lib/format';

export interface AgentChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly at: string;
  readonly simulated: boolean;
}

/**
 * A direct conversation with one roster member. Server state is the only
 * state — every turn round-trips, so the transcript is always the record.
 */
export function AgentChat({
  scopeKey,
  agentId,
  agentName,
  messages,
}: {
  scopeKey: string;
  agentId: string;
  agentName: string;
  messages: readonly AgentChatMessage[];
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="stack" style={{ gap: 'var(--s-3)', maxHeight: '30rem', overflowY: 'auto' }}>
        {messages.length === 0 ? (
          <p className="prose">
            {agentName} answers from this space’s records — ask something they would know.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`msg msg--${message.role === 'user' ? 'founder' : 'assistant'}`}
            >
              <div className="msg-meta">
                {message.role === 'user' ? 'You' : agentName} · {formatRelative(message.at)}
                {message.simulated ? ' · composed locally' : ''}
              </div>
              <div className="msg-body">{message.text}</div>
            </div>
          ))
        )}
      </div>

      <form
        className="row"
        style={{ gap: 'var(--s-2)' }}
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          setDraft('');
          startTransition(async () => {
            const result = await speakToAgent(scopeKey, agentId, text);
            if (!result.ok) {
              // Give the words back — a rejected turn (credential-shaped input,
              // a closed space) should not also cost the founder their message.
              setDraft(text);
              setError(result.error ?? 'That did not go through.');
            } else {
              setError(null);
            }
          });
        }}
      >
        <input
          className="input grow"
          placeholder={`Ask ${agentName}…`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={pending}
        />
        <button className="btn btn--primary" type="submit" disabled={pending || !draft.trim()}>
          {pending ? `${agentName} is thinking…` : 'Send'}
        </button>
      </form>
      <span className="hint" role="status">
        {error ?? 'Grounded in this space’s records. Anything that would act still stops for your approval.'}
      </span>
    </div>
  );
}
