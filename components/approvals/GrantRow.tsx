'use client';

import { useTransition } from 'react';

import type { PermissionGrant } from '@/lib/domain';
import { formatRelative } from '@/lib/format';
import { revokeGrant } from '@/lib/actions/grants';
import { Badge } from '@/components/ui/primitives';

/** One standing grant, with the only control that matters always in reach. */
export function GrantRow({
  grant,
  active,
  serverName,
  spaceLabel,
}: {
  grant: PermissionGrant;
  active: boolean;
  serverName: string;
  spaceLabel: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="list-row">
      <div className="grow">
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          <span className="list-primary mono">{grant.toolName}</span>
          <Badge tone="outline">{serverName}</Badge>
          <Badge tone="outline">{spaceLabel}</Badge>
          {active ? <Badge tone="warn">Runs without asking</Badge> : <Badge tone="outline">Inactive</Badge>}
        </div>
        <div className="list-secondary">
          {grant.note} · granted {formatRelative(grant.createdAt)}
          {grant.expiresAt && !grant.revokedAt
            ? ` · expires ${formatRelative(grant.expiresAt)}`
            : ''}
          {grant.revokedAt ? ` · revoked ${formatRelative(grant.revokedAt)}` : ''}
        </div>
      </div>
      <div className="list-meta">
        {!grant.revokedAt ? (
          <button
            className="btn btn--ghost"
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => revokeGrant(grant.id))}
          >
            {pending ? 'Revoking…' : 'Revoke'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
