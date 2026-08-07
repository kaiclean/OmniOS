import Link from 'next/link';

import type { TimelineEvent } from '@/lib/data/aggregate';
import { TIMELINE_KIND_LABELS } from '@/lib/data/aggregate';
import { formatDate, formatRelative } from '@/lib/format';
import type { Tone } from '@/components/ui/primitives';
import { Badge, Empty, ListRow, SimulatedMark } from '@/components/ui/primitives';

/**
 * One rendering of the audit trail, shared by Mission Control and the full
 * Timeline so the two can never describe the same event differently.
 */
const EVENT_TONES: Record<TimelineEvent['tone'], Tone> = {
  ok: 'ok',
  warn: 'deny',
  pending: 'warn',
  neutral: 'outline',
};

export function TimelineList({
  events,
  groupByDay = false,
}: {
  events: readonly TimelineEvent[];
  groupByDay?: boolean;
}) {
  if (events.length === 0) {
    return (
      <Empty title="Nothing recorded yet">
        Every action, decision, meeting, run, grant and upgrade shows up here the moment it exists.
      </Empty>
    );
  }

  if (!groupByDay) {
    return (
      <div className="list">
        {events.map((event) => (
          <TimelineRow key={event.id} event={event} />
        ))}
      </div>
    );
  }

  const days: Array<{ day: string; items: TimelineEvent[] }> = [];
  for (const event of events) {
    const day = event.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(event);
    else days.push({ day, items: [event] });
  }

  return (
    <div className="list">
      {days.map(({ day, items }) => (
        <div key={day}>
          <div className="list-row">
            <span className="eyebrow">{formatDate(day)}</span>
          </div>
          {items.map((event) => (
            <TimelineRow key={event.id} event={event} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  return (
    <ListRow
      primary={<Link href={event.href}>{event.title}</Link>}
      secondary={
        <>
          {event.spaceLabel}
          {event.detail ? ` · ${event.detail}` : ''}
          {event.simulated ? (
            <>
              {' '}
              <SimulatedMark />
            </>
          ) : null}
        </>
      }
      meta={formatRelative(event.at)}
      trailing={
        <Badge tone={EVENT_TONES[event.tone]} dot={event.tone === 'pending'}>
          {TIMELINE_KIND_LABELS[event.kind]}
        </Badge>
      }
    />
  );
}
