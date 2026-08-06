import Link from 'next/link';

import type { OverviewSnapshot } from '@/lib/data/aggregate';
import { EMPTY, formatMinorAmount, formatNumber } from '@/lib/format';
import { energyLabel } from '@/lib/personal/energy';

/**
 * The unified overview.
 *
 * It never changes when you move between spaces — that constancy is the point.
 * Whichever room the founder is standing in, the same nine numbers describe
 * their whole world, life and business together, which is the only vantage from
 * which the trade-offs between them are visible.
 *
 * Money is month-to-date and excludes forecasts. A daily figure would be a row
 * of dashes on most days; a figure that mixed in projections would be a lie.
 */
export function Strip({ snapshot }: { snapshot: OverviewSnapshot }) {
  const { money, energy } = snapshot;

  return (
    <>
      <Cell label="Revenue · MTD" value={formatMinorAmount(money.inMinor, money.currency, { compact: true })} />
      <Cell label="Costs · MTD" value={formatMinorAmount(money.outMinor, money.currency, { compact: true })} />
      <Cell
        label="Profit · MTD"
        value={formatMinorAmount(money.netMinor, money.currency, { compact: true })}
        tone={money.netMinor >= 0 ? 'good' : 'bad'}
      />
      <Cell
        label="Energy"
        value={energy === null ? EMPTY : formatNumber(energy)}
        suffix={energy === null ? 'not logged' : energyLabel(energy)}
        href="/life/health"
      />
      <Cell
        label="Done today"
        value={formatNumber(snapshot.tasksDoneToday)}
        suffix={`${formatNumber(snapshot.tasksOpen)} open`}
      />
      <Cell
        label="Recommendations"
        value={formatNumber(snapshot.openSuggestions)}
        suffix="open"
        href="/"
      />
      <Cell
        label="Awaiting you"
        value={formatNumber(snapshot.upgradesAwaiting + snapshot.unreadNotifications)}
        suffix={snapshot.upgradesAwaiting > 0 ? 'upgrade decisions' : 'nothing urgent'}
        href="/intelligence/upgrades"
        tone={snapshot.upgradesAwaiting > 0 ? 'warn' : undefined}
      />
    </>
  );
}

function Cell({
  label,
  value,
  suffix,
  href,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  href?: string;
  tone?: 'good' | 'bad' | 'warn';
}) {
  const body = (
    <>
      <span className="strip-label">{label}</span>
      <span className="strip-value">
        <span className={tone ? `delta--${tone === 'warn' ? 'flat' : tone}` : undefined}>{value}</span>
        {suffix ? <span className="strip-suffix">{suffix}</span> : null}
      </span>
    </>
  );

  if (!href) return <div className="strip-cell">{body}</div>;
  return (
    <Link className="strip-cell strip-cell--link" href={href}>
      {body}
    </Link>
  );
}
