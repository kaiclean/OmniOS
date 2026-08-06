'use client';

import { useState, useTransition } from 'react';

import { forgetSharedMemory } from '@/lib/actions/memory';

/**
 * Removing one record from shared memory.
 *
 * Two clicks rather than a modal: shared memory is read by every space, so this
 * is not a trivial delete — but it is also not the workspace reset, and a dialog
 * for every row would make the region unusable. The second click is the guard.
 */
export function ForgetShared({
  capabilityId,
  recordId,
}: {
  capabilityId: string;
  recordId: string;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <span className="row" style={{ gap: 'var(--s-2)' }}>
      {error ? <span className="hint delta--bad">{error}</span> : null}
      <button
        type="button"
        className={armed ? 'btn btn--danger btn--sm' : 'btn btn--ghost btn--sm'}
        disabled={pending}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setError(null);
          start(async () => {
            const result = await forgetSharedMemory(capabilityId, recordId);
            if (!result.ok) {
              setArmed(false);
              setError(result.error ?? 'That could not be forgotten.');
            }
          });
        }}
      >
        {pending ? 'Forgetting…' : armed ? 'Confirm — forget everywhere' : 'Forget'}
      </button>
    </span>
  );
}
