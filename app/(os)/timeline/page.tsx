import type { Metadata } from 'next';
import Link from 'next/link';

import type { TimelineKind } from '@/lib/data/aggregate';
import { TIMELINE_KINDS, TIMELINE_KIND_LABELS, buildTimeline, loadSpaces } from '@/lib/data/aggregate';
import { getWorkspace } from '@/lib/data/store';
import { pluralise } from '@/lib/format';
import { TimelineList } from '@/components/timeline/TimelineList';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Timeline' };

/**
 * The full audit trail, filterable by kind and space. Filters are links, not
 * client state: the URL is the filter, so any view of the history can be
 * shared, bookmarked or reloaded and stay exactly what it was.
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; space?: string }>;
}) {
  const params = await searchParams;
  const [workspace, spaces] = await Promise.all([getWorkspace(), loadSpaces()]);

  const kind = TIMELINE_KINDS.find((candidate) => candidate === params.kind);
  const spaceKeys = ['os', ...spaces.map((space) => space.scopeKey)];
  const spaceKey = spaceKeys.find((candidate) => candidate === params.space);

  const events = buildTimeline(spaces, workspace, {
    ...(kind ? { kinds: [kind] } : {}),
    ...(spaceKey ? { spaceKey } : {}),
  });

  const hrefFor = (next: { kind?: TimelineKind; space?: string }) => {
    const query = new URLSearchParams();
    const wantKind = 'kind' in next ? next.kind : kind;
    const wantSpace = 'space' in next ? next.space : spaceKey;
    if (wantKind) query.set('kind', wantKind);
    if (wantSpace) query.set('space', wantSpace);
    const suffix = query.toString();
    return suffix ? `/timeline?${suffix}` : '/timeline';
  };

  return (
    <>
      <PageHead
        eyebrow="OS"
        title="Timeline"
        lede="Everything that happened, in order: actions and their decisions, meetings, runs, grants and upgrades. Derived from the records themselves — an audit trail with no second copy to drift."
        actions={<Badge tone="outline">{pluralise(events.length, 'event')}</Badge>}
      />

      <div className="row wrap" style={{ gap: 'var(--s-2)', marginBottom: 'var(--s-4)' }}>
        <Link
          className={kind ? 'btn btn--ghost btn--sm' : 'btn btn--secondary btn--sm'}
          href={hrefFor({ kind: undefined })}
        >
          Everything
        </Link>
        {TIMELINE_KINDS.map((candidate) => (
          <Link
            key={candidate}
            className={kind === candidate ? 'btn btn--secondary btn--sm' : 'btn btn--ghost btn--sm'}
            href={hrefFor({ kind: candidate })}
          >
            {TIMELINE_KIND_LABELS[candidate]}
          </Link>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 'var(--s-2)', marginBottom: 'var(--s-6)' }}>
        <Link
          className={spaceKey ? 'btn btn--ghost btn--sm' : 'btn btn--secondary btn--sm'}
          href={hrefFor({ space: undefined })}
        >
          All spaces
        </Link>
        {spaces.map((space) => (
          <Link
            key={space.scopeKey}
            className={spaceKey === space.scopeKey ? 'btn btn--secondary btn--sm' : 'btn btn--ghost btn--sm'}
            href={hrefFor({ space: space.scopeKey })}
          >
            {space.label}
          </Link>
        ))}
        <Link
          className={spaceKey === 'os' ? 'btn btn--secondary btn--sm' : 'btn btn--ghost btn--sm'}
          href={hrefFor({ space: 'os' })}
        >
          OmniOS
        </Link>
      </div>

      <div className="grid">
        <Panel
          span={12}
          flush
          footer="Rejections, failures and revocations stay. What the system tried to do is part of the record."
        >
          <TimelineList events={events} groupByDay />
        </Panel>
      </div>
    </>
  );
}
