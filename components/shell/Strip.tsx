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
 * Cells are built as data rather than written as JSX because this component is
 * rendered on the server and handed to a Client Component as a prop: a fragment
 * crossing that boundary is serialised as a list, and a list needs keys.
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

  return cells.map((cell) => <Cell key={cell.id} {...cell} />);
}

function Cell({ label, value, suffix, href, tone }: CellSpec) {
  const body = (
    <>
      <span className="strip-label">{label}</span>
      <span className="strip-value">
        <span className={tone && tone !== 'warn' ? `delta--${tone}` : undefined}>{value}</span>
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
