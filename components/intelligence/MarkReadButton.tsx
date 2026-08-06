'use client';

import { useState, useTransition } from 'react';

import { markReportRead } from '@/lib/actions/intelligence';

/**
 * Read state is a toggle, not a one-way door. A founder who marks a report read
 * while half-way through it needs to be able to put it back.
 */
export function MarkReadButton({ reportId, read }: { reportId: string; read: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="row">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markReportRead(reportId, !read);
            if (!result.ok) setError(result.error ?? 'That could not be saved.');
          });
        }}
      >
        {pending ? 'Saving…' : read ? 'Mark unread' : 'Mark read'}
      </button>
      {error ? (
        <span className="hint delta--bad" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
