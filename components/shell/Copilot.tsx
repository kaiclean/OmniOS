'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import type { AssistantMessage } from '@/lib/domain';
import { askAssistant } from '@/lib/actions/assistant';
import { specialistName } from '@/lib/ai/specialists';
import { getCapability } from '@/lib/capabilities/registry';
import { derivePageContext, pageContextLabelParts, targetKeyForPage } from '@/lib/ui/page-context';
import { Icon } from '@/components/ui/Icon';

export interface CopilotProps {
  assistantName: string;
  providerLabel: string;
  providerSimulated: boolean;
  initialMessages: readonly AssistantMessage[];
  companyNames: Readonly<Record<string, string>>;
  personalName: string;
  suggestions: readonly string[];
  /** Empty-state chips when the founder is inside a company. */
  companySuggestions: readonly string[];
}

/**
 * The one AI surface.
 *
 * There is no agent picker here and there never will be. What the founder gets
 * instead is disclosure: every reply names the space it was answered from and
 * carries an expandable plan showing which specialists ran and on what evidence.
 */
export function Copilot({
  assistantName,
  providerLabel,
  providerSimulated,
  initialMessages,
  companyNames,
  personalName,
  suggestions,
  companySuggestions,
  onClose,
}: CopilotProps & {
  /**
   * Supplied by the shell, not by the server — closing is a shell concern.
   * Only rendered where the copilot is a sheet; the permanent column is
   * dismissed from the strip.
   */
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const page = useMemo(() => derivePageContext(pathname), [pathname]);
  const targetKey = targetKeyForPage(page);
  const [messages, setMessages] = useState<AssistantMessage[]>([...initialMessages]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scopeLabel = useMemo(() => {
    if (targetKey === 'founder') return 'Everything';
    if (targetKey === 'personal') return personalName;
    const id = targetKey.slice('company:'.length);
    return companyNames[id] ?? 'Company';
  }, [targetKey, companyNames, personalName]);

  // "Meridian Build / Marketing" — what the assistant will read the question
  // against. Shown above the composer so context is never a surprise.
  const contextParts = useMemo(
    () =>
      pageContextLabelParts(page, {
        companyNames,
        personalName,
        capabilityName: (id) => getCapability(id)?.name,
      }),
    [page, companyNames, personalName],
  );

  const emptyStateSuggestions = targetKey.startsWith('company:') ? companySuggestions : suggestions;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending]);

  // The seam is the system's single ambient signal. It lives in the shell, so
  // reach for it directly rather than lifting transient state up through props.
  useEffect(() => {
    document.querySelector('.seam')?.setAttribute('data-thinking', pending ? 'true' : 'false');
  }, [pending]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setDraft('');
    startTransition(async () => {
      const result = await askAssistant(targetKey, trimmed, pathname);
      const reply = result.message;
      if (!result.ok || !reply) {
        setError(result.error ?? 'That did not work.');
        setDraft(trimmed);
        return;
      }
      const echo: AssistantMessage = {
        ...reply,
        id: `${reply.id}:echo`,
        role: 'founder',
        text: trimmed,
        plan: undefined,
      };
      setMessages((current) => [...current, echo, reply]);
    });
  };

  return (
    <aside className="copilot" aria-label="Executive Assistant">
      <header className="copilot-head">
        <Icon name="assistant" />
        <div className="grow">
          <div className="row" style={{ gap: 'var(--s-2)' }}>
            <strong style={{ fontSize: 'var(--fs-small)', fontWeight: 'var(--weight-medium)' }}>
              {assistantName}
            </strong>
            <span className="badge badge--outline">{scopeLabel}</span>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            className="btn btn--ghost btn--icon copilot-close"
            aria-label="Close assistant"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </header>

      <div className="copilot-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="stack">
            <p className="prose">
              I can see {scopeLabel === 'Everything' ? 'every space you own' : scopeLabel} and the
              shared knowledge your capabilities have accumulated. Ask me anything — I will decide
              which specialists to consult.
            </p>
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              {emptyStateSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="palette-item"
                  onClick={() => send(suggestion)}
                >
                  <Icon name="chevron-right" />
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => <Message key={message.id} message={message} />)
        )}

        {pending ? (
          <p className="msg-meta" role="status">
            Consulting specialists…
          </p>
        ) : null}
        {error ? (
          <p className="note note--warn" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <form
        className="copilot-compose"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <span className="hint" aria-label="Assistant context">
            {contextParts.join(' / ')}
          </span>
          <textarea
            data-copilot-input
            className="textarea"
            style={{ minHeight: '3.75rem' }}
            placeholder={`Ask ${assistantName}…`}
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
            <span className="sim-mark">
              {providerSimulated ? 'Local reasoning · no model' : providerLabel}
            </span>
            <button className="btn btn--primary btn--sm" type="submit" disabled={pending || !draft.trim()}>
              {pending ? 'Working…' : 'Ask'}
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function Message({ message }: { message: AssistantMessage }) {
  const isFounder = message.role === 'founder';
  return (
    <div className={`msg msg--${isFounder ? 'founder' : 'assistant'}`}>
      <div className="msg-body">{message.text}</div>
      {!isFounder && message.plan ? (
        <>
          <details className="plan">
            <summary>
              <Icon name="chevron-right" size={12} />
              {message.plan.summary}
            </summary>
            <div className="plan-body">
              {message.plan.steps.map((step) => (
                <div key={step.id} className="plan-step">
                  <div className="grow">
                    <div className="plan-step-name">{specialistName(step.specialistId)}</div>
                    <div>{step.objective}</div>
                    {step.output ? <div className="faint">{step.output}</div> : null}
                  </div>
                  <span className="faint">{Math.round(step.confidence * 100)}%</span>
                </div>
              ))}
              {message.plan.contextUsed.length > 0 ? (
                <div className="plan-step">
                  <div className="grow">
                    <div className="plan-step-name">Evidence used</div>
                    <div className="faint">
                      {message.plan.contextUsed.map((c) => c.label).join(' · ')}
                    </div>
                  </div>
                </div>
              ) : null}
              {message.plan.requiresApproval ? (
                <p className="note note--warn">{message.plan.approvalReason}</p>
              ) : null}
            </div>
          </details>
          {message.simulated ? (
            <span className="sim-mark">Generated locally from your records</span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
