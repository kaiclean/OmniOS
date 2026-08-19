'use client';

import { useState, useTransition } from 'react';

import type { Scope, ToolCall } from '@/lib/domain';
import { RISK_EXPLANATION, parseMcpToolId } from '@/lib/domain';
import { approveToolCall, rejectToolCall } from '@/lib/actions/tools';
import { approveAndAlwaysAllow } from '@/lib/actions/grants';
import { Badge, RelativeTime } from '@/components/ui/primitives';

/**
 * One decision.
 *
 * The preview is the point of this row: it was computed from the coerced
 * arguments at the moment the call was proposed, so what is read here is what
 * would run — not a summary written separately and hoped to still be accurate.
 */
export function ApprovalRow({
  call,
  toolLabel,
  spaceLabel,
}: {
  call: ToolCall;
  toolLabel?: string;
  spaceLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [showArgs, setShowArgs] = useState(false);

  const args = Object.entries(call.args).filter(([, value]) => value !== undefined && value !== '');

  return (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          <span className="list-primary">{toolLabel ?? call.toolId}</span>
          <Badge tone={call.risk === 'destructive' || call.risk === 'external' ? 'warn' : 'outline'}>
            {call.risk}
          </Badge>
          <Badge tone="outline">{spaceLabel}</Badge>
        </div>

        <p className="prose">{call.preview}</p>

        <span className="hint">
          {RISK_EXPLANATION[call.risk]} Proposed <RelativeTime at={call.at} />.
        </span>

        {args.length > 0 ? (
          <>
            <button className="btn btn--ghost" type="button" onClick={() => setShowArgs((open) => !open)}>
              {showArgs ? 'Hide arguments' : `Show ${args.length} argument${args.length === 1 ? '' : 's'}`}
            </button>
            {showArgs ? (
              <div className="stack" style={{ gap: 'var(--s-1)' }}>
                {args.map(([key, value]) => (
                  <div key={key} className="row" style={{ gap: 'var(--s-2)', alignItems: 'flex-start' }}>
                    <span className="mono hint">{key}</span>
                    <span className="mono" style={{ fontSize: 'var(--fs-small)', overflowWrap: 'anywhere' }}>
                      {String(value)}
                    </span>
                  </div>
                ))}
                <span className="hint">
                  A <span className="mono">{'{{secret:NAME}}'}</span> here stays a placeholder in this
                  record. The value is fetched inside the call and never written back.
                </span>
              </div>
            ) : null}
          </>
        ) : null}

        {outcome ? (
          <span className="hint" role="status">
            {outcome}
          </span>
        ) : null}
      </div>

      <div className="list-meta row" style={{ gap: 'var(--s-2)' }}>
        <button
          className="btn btn--ghost"
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const rejected = await rejectToolCall(call.scope as Scope, call.id);
              setOutcome(
                rejected
                  ? 'Rejected. Nothing ran.'
                  : 'Already decided elsewhere — reload to see what happened.',
              );
            })
          }
        >
          Reject
        </button>
        {parseMcpToolId(call.toolId) ? (
          // Only a connection tool can carry a standing grant. The one-week cap
          // here is deliberate: "always, forever" is a decision for the grants
          // panel with the revoke button in view, not a reflex on a queue row.
          <button
            className="btn btn--secondary"
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await approveAndAlwaysAllow(call.scope as Scope, call.id, 'week');
                setOutcome(
                  result.ok
                    ? `${result.summary} Identical calls in this space now run without asking, for one week. Revoke any time under Standing grants.`
                    : result.summary,
                );
              })
            }
          >
            Approve · allow for a week
          </button>
        ) : null}
        <button
          className="btn btn--primary"
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await approveToolCall(call.scope as Scope, call.id);
              setOutcome(result.summary);
            })
          }
        >
          {pending ? 'Running…' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
