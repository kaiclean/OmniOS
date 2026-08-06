'use client';

import { useActionState } from 'react';

import { generateAssetsFromBrief, type CreativeFormState } from '@/lib/actions/creative';

const INITIAL: CreativeFormState = { ok: false };

/**
 * "Generate assets from this brief."
 *
 * One instance per brief, so each carries its own pending and result state — a
 * founder generating from three briefs in a row can see which one answered.
 */
export function GenerateAssetsButton({
  scopeKey,
  briefId,
  formatCount,
}: {
  scopeKey: string;
  briefId: string;
  formatCount: number;
}) {
  const [state, action, pending] = useActionState(generateAssetsFromBrief, INITIAL);

  return (
    <form action={action} className="stack" style={{ gap: 'var(--s-2)' }}>
      <input type="hidden" name="scopeKey" value={scopeKey} />
      <input type="hidden" name="briefId" value={briefId} />
      <div className="spread">
        <span className="hint">
          {formatCount === 1 ? '1 format' : `${formatCount} formats`} · prompt composed locally
        </span>
        <button className="btn btn--secondary btn--sm" type="submit" disabled={pending}>
          {pending ? 'Writing records…' : 'Generate assets'}
        </button>
      </div>
      {state.message ? (
        <span className={state.ok ? 'hint' : 'hint delta--bad'} role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
