/**
 * Rendering for one side of the ledger (company or personal). Server Component.
 */

import Link from 'next/link';
import type { CurrencyCode } from '@/lib/domain';
import {
  EMPTY,
  formatDate,
  formatMinorAmount,
  formatNumber,
  formatPercent,
  pluralise,
} from '@/lib/format';
import {
  Badge,
  Empty,
  Meter,
  Metric,
  MetricGrid,
  Panel,
  SectionHead,
  SimulatedMark,
  Spark,
} from '@/components/ui/primitives';
import {
  ANOMALY_MULTIPLE,
  MIN_CATEGORY_SAMPLE,
  MONTHS_SHOWN,
  median,
  type MoneyView,
  type SplitTotal,
} from './view';

/* ----------------------------------------------------------------- render -- */

export function MoneySide({
  title,
  blurb,
  view,
  emptyHint,
}: {
  title: string;
  blurb: string;
  view: MoneyView;
  emptyHint: string;
}) {
  const money = (minor: number | null) =>
    formatMinorAmount(minor, view.currency, { compact: true });

  if (view.actualCount === 0 && view.forecastCount === 0) {
    return (
      <section className="money-side">
        <SectionHead title={title} />
        <Panel span={12}>
          <Empty title="No ledger entries in this half">{emptyHint}</Empty>
        </Panel>
      </section>
    );
  }

  const monthly = view.monthsWithActuals > 0 ? view.outgoing.recurringMinor / view.monthsWithActuals : null;

  return (
    <section className="money-side">
      <SectionHead
        title={title}
        action={
          <span className="row wrap">
            {view.mixedCurrency ? (
              <Badge tone="warn">mixed currencies · not converted</Badge>
            ) : (
              <Badge tone="outline">{view.currency}</Badge>
            )}
            <span className="hint">{blurb}</span>
          </span>
        }
      />

      <div className="grid">
        <Panel
          title="Consolidated position"
          span={12}
          subtitle={`${pluralise(view.actualCount, 'recorded entry', 'recorded entries')} across ${pluralise(view.monthsWithActuals, 'month')} · ${pluralise(view.forecastCount, 'forecast entry', 'forecast entries')} excluded from every figure here`}
        >
          <MetricGrid>
            <Metric
              label="Money in"
              value={money(view.inMinor)}
              hint={`${pluralise(view.incoming.recurringCount, 'recurring entry', 'recurring entries')}`}
            />
            <Metric
              label="Money out"
              value={money(view.outMinor)}
              hint={`${pluralise(view.outgoing.recurringCount, 'recurring entry', 'recurring entries')}`}
            />
            <Metric
              label="Net position"
              value={money(view.netMinor)}
              delta={{
                text: view.netMinor >= 0 ? 'in surplus' : 'in deficit',
                tone: view.netMinor >= 0 ? 'good' : 'bad',
              }}
              series={view.series}
              hint="Actuals and committed only"
            />
            <Metric
              label="Recurring cost base"
              value={monthly === null ? EMPTY : money(Math.round(monthly))}
              hint={monthly === null ? 'No months recorded' : 'Per month, averaged over recorded months'}
            />
          </MetricGrid>
        </Panel>

        <Panel
          title="Net by month"
          span={8}
          subtitle={`Last ${MONTHS_SHOWN} months · ${view.series.length} with recorded entries`}
          flush
        >
          <div className="panel-body" style={{ paddingBottom: 0 }}>
            <Spark
              series={view.series}
              tone={view.netMinor >= 0 ? 'good' : 'bad'}
            />
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="num">In</th>
                  <th scope="col" className="num">Out</th>
                  <th scope="col" className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {view.months.map((month) => (
                  <tr key={month.key}>
                    <td className="mono">{month.key}</td>
                    <td className="num">{month.count === 0 ? EMPTY : money(month.inMinor)}</td>
                    <td className="num">{month.count === 0 ? EMPTY : money(month.outMinor)}</td>
                    <td className={month.count === 0 ? 'num' : `num delta--${month.netMinor >= 0 ? 'good' : 'bad'}`}>
                      {month.count === 0 ? EMPTY : money(month.netMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Per space" span={4} subtitle="Each ledger, kept whole" flush>
          <div className="list">
            {view.spaceTotals.map((total) => (
              <Link key={total.space.scopeKey} className="list-row" href={`${total.space.href}/finance`}>
                <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                  <span className="list-primary truncate">{total.space.label}</span>
                  <span className="list-secondary">
                    {money(total.inMinor)} in · {money(total.outMinor)} out
                    {total.forecastCount > 0 ? ` · ${total.forecastCount} forecast excluded` : ''}
                  </span>
                </div>
                <span className={`list-meta delta--${total.netMinor >= 0 ? 'good' : 'bad'}`}>
                  {money(total.netMinor)}
                </span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="Top cost categories"
          span={6}
          subtitle={`${pluralise(view.costCategories.length, 'category', 'categories')} with recorded spend`}
        >
          {view.costCategories.length === 0 ? (
            <Empty title="Nothing has gone out yet" />
          ) : (
            <div className="stack" style={{ gap: 'var(--s-3)' }}>
              {view.costCategories.slice(0, 8).map((category) => (
                <div key={category.category} className="stack" style={{ gap: 'var(--s-2)' }}>
                  <div className="spread">
                    <span>{category.category}</span>
                    <span className="list-meta">
                      {money(category.totalMinor)}
                      <span className="faint">
                        {' '}
                        · {formatPercent((category.totalMinor / view.outMinor) * 100, 1)}
                      </span>
                    </span>
                  </div>
                  {/* Weight against the largest category, not against total spend:
                      the question this answers is "what dominates", and shares of
                      total flatten to invisibility once there are eight of them. */}
                  <Meter
                    value={category.totalMinor / (view.costCategories[0]?.totalMinor ?? category.totalMinor)}
                    label={`${category.category} against the largest cost category`}
                  />
                  <span className="list-secondary">
                    {pluralise(category.count, 'entry', 'entries')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Recurring versus one-off"
          span={6}
          subtitle="Recurring is what continues if you stop deciding anything"
        >
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Direction</th>
                  <th scope="col" className="num">Recurring</th>
                  <th scope="col" className="num">One-off</th>
                  <th scope="col" className="num">Recurring share</th>
                </tr>
              </thead>
              <tbody>
                <SplitRow label="In" split={view.incoming} currency={view.currency} />
                <SplitRow label="Out" split={view.outgoing} currency={view.currency} />
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Anomalies"
          span={12}
          subtitle={`Entries more than ${formatNumber(ANOMALY_MULTIPLE, 1)}× the median for the same category and direction in the same ledger`}
          action={<SimulatedMark label="Computed from your ledger" />}
          footer={`${pluralise(view.testedCategories, 'population')} tested — one per ledger, category and direction · ${view.untestedCategories} skipped for holding fewer than ${MIN_CATEGORY_SAMPLE} entries, where a median describes the sample rather than a norm.`}
          flush
        >
          {view.anomalies.length === 0 ? (
            <Empty title="Nothing stands out">
              Every recorded entry sits within {formatNumber(ANOMALY_MULTIPLE, 1)}× of its category
              median. That is a statement about this ledger, not a clean bill of health.
            </Empty>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Entry</th>
                    <th scope="col">Space</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="num">Amount</th>
                    <th scope="col" className="num">Category median</th>
                    <th scope="col" className="num">Multiple</th>
                  </tr>
                </thead>
                <tbody>
                  {view.anomalies.slice(0, 12).map((anomaly) => (
                    <tr key={anomaly.entry.id}>
                      <td>
                        <div className="list-primary">{anomaly.entry.label}</div>
                        <div className="list-secondary">
                          {formatDate(anomaly.entry.date)}
                          {anomaly.entry.confidence !== 'actual' ? ` · ${anomaly.entry.confidence}` : ''}
                          {anomaly.entry.recurring ? ' · recurring' : ''}
                        </div>
                      </td>
                      <td className="faint">{anomaly.space.label}</td>
                      <td className="faint">
                        {anomaly.entry.category}
                        <span className="list-secondary"> · {anomaly.entry.direction}</span>
                      </td>
                      <td className="num">
                        {formatMinorAmount(anomaly.entry.amount.amount, anomaly.entry.amount.currency, {
                          showCurrency: false,
                        })}
                      </td>
                      <td className="num faint">
                        {formatMinorAmount(anomaly.medianMinor, anomaly.entry.amount.currency, {
                          showCurrency: false,
                        })}
                        <span className="list-secondary"> · n={anomaly.sample}</span>
                      </td>
                      <td className="num">
                        <Badge tone={anomaly.multiple >= 4 ? 'deny' : 'warn'}>
                          {formatNumber(anomaly.multiple, 1)}×
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Forecast"
          span={12}
          subtitle="Kept out of every number above. Shown here alone so it can never be read as income."
          action={<SimulatedMark label="Projected, not recorded" />}
        >
          {view.forecastCount === 0 ? (
            <Empty title="No forecast entries" />
          ) : (
            <MetricGrid>
              <Metric
                label="Forecast in"
                value={money(view.forecastInMinor)}
                hint={`Across ${pluralise(view.forecastMonths, 'month')}`}
              />
              <Metric
                label="Forecast out"
                value={money(view.forecastOutMinor)}
                hint={`Across ${pluralise(view.forecastMonths, 'month')}`}
              />
              <Metric
                label="Forecast net"
                value={money(view.forecastInMinor - view.forecastOutMinor)}
                hint="Not added to your position"
              />
              <Metric
                label="Entries excluded"
                value={formatNumber(view.forecastCount)}
                hint="Every figure above ignores these"
              />
            </MetricGrid>
          )}
        </Panel>
      </div>
    </section>
  );
}

function SplitRow({
  label,
  split,
  currency,
}: {
  label: string;
  split: SplitTotal;
  currency: CurrencyCode;
}) {
  const total = split.recurringMinor + split.oneOffMinor;
  // No entries of a kind is an absence, not a zero balance: a founder reading
  // "CHF 0" would think something was measured and came to nothing.
  return (
    <tr>
      <td>{label}</td>
      <td className="num">
        {split.recurringCount === 0
          ? EMPTY
          : formatMinorAmount(split.recurringMinor, currency, { compact: true })}
        <span className="list-secondary"> · {pluralise(split.recurringCount, 'entry', 'entries')}</span>
      </td>
      <td className="num">
        {split.oneOffCount === 0
          ? EMPTY
          : formatMinorAmount(split.oneOffMinor, currency, { compact: true })}
        <span className="list-secondary"> · {pluralise(split.oneOffCount, 'entry', 'entries')}</span>
      </td>
      <td className="num">{total === 0 ? EMPTY : formatPercent((split.recurringMinor / total) * 100)}</td>
    </tr>
  );
}
