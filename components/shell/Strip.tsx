import Link from 'next/link';

import type { OverviewSnapshot } from '@/lib/data/aggregate';
import { EMPTY, formatMinorAmount, formatNumber } from '@/lib/format';
import { energyLabel } from '@/lib/personal/energy';

interface CellSpec {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly suffix?: string;
  readonly href?: string;
  readonly tone?: 'good' | 'bad' | 'warn';
}

/**
 * The unified overview.
 *
 * It never changes when you move between spaces — that constancy is the point.
 * Whichever room the founder is standing in, the same numbers describe their
 * whole world, life and business together, which is the only vantage from which
 * the trade-offs between them are visible.
 *
 * Money is month-to-date and excludes forecasts. A daily figure would be a row
 * of dashes on most days; a figure that mixed in projections would be a lie.
 *
 * This component renders on the server and is handed to a Client Component as a
 * prop, so it must return a **single root element** — it owns its own scroll
 * container for that reason. Anything list-shaped at that boundary (a fragment
 * or a bare array) is serialised as children of the client component, which then
 * warns about missing keys no matter how well the items themselves are keyed:
 * the unkeyed thing is the boundary element, not the cells.
 */
export function Strip({ snapshot }: { snapshot: OverviewSnapshot }) {
  const { money, energy } = snapshot;
  const awaiting = snapshot.upgradesAwaiting + snapshot.unreadNotifications;

  const cells: CellSpec[] = [
    {
      id: 'revenue',
      label: 'Revenue · MTD',
      value: formatMinorAmount(money.inMinor, money.currency, { compact: true }),
    },
    {
      id: 'costs',
      label: 'Costs · MTD',
      value: formatMinorAmount(money.outMinor, money.currency, { compact: true }),
    },
    {
      id: 'profit',
      label: 'Profit · MTD',
      value: formatMinorAmount(money.netMinor, money.currency, { compact: true }),
      tone: money.netMinor >= 0 ? 'good' : 'bad',
    },
    {
      id: 'energy',
      label: 'Energy',
      value: energy === null ? EMPTY : formatNumber(energy),
      suffix: energy === null ? 'not logged' : energyLabel(energy),
      href: '/life/health',
    },
    {
      id: 'done',
      label: 'Done today',
      value: formatNumber(snapshot.tasksDoneToday),
      suffix: `${formatNumber(snapshot.tasksOpen)} open`,
    },
    {
      id: 'recommendations',
      label: 'Recommendations',
      value: formatNumber(snapshot.openSuggestions),
      suffix: 'open',
      href: '/',
    },
    {
      id: 'awaiting',
      label: 'Awaiting you',
      value: formatNumber(awaiting),
      suffix: snapshot.upgradesAwaiting > 0 ? 'upgrade decisions' : 'nothing urgent',
      href: '/intelligence/upgrades',
      ...(snapshot.upgradesAwaiting > 0 ? { tone: 'warn' as const } : {}),
    },
  ];

  return (
    <div className="strip-scroll">
      {cells.map((cell) => (
        <Cell key={cell.id} {...cell} />
      ))}
    </div>
  );
}

function Cell({ label, value, suffix, href, tone }: CellSpec) {
  const body = (
    <>
      <span className="strip-label">{label}</span>
      <span className="strip-value">
        <span className={tone ? `delta--${tone}` : undefined}>{value}</span>
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
