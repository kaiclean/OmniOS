import type { Metadata } from 'next';
import Link from 'next/link';

import { acrossSpaces, loadSpaces, type SpaceView } from '@/lib/data/aggregate';
import type { CurrencyCode, FinanceEntry } from '@/lib/domain';
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
  Note,
  PageHead,
  Panel,
  SectionHead,
  SimulatedMark,
  Spark,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Finance Center' };

/** Months drawn in the net-by-month view. */
const MONTHS_SHOWN = 12;

/** An entry this many times its category median is worth a founder's second look. */
const ANOMALY_MULTIPLE = 2.5;

/**
 * Below this many entries a median is an artefact of the sample, not a norm — a
 * category with two rows would flag the larger one every time. Untested
 * categories are counted and named in the UI rather than silently skipped.
 */
const MIN_CATEGORY_SAMPLE = 4;

type LedgerRow = { readonly item: FinanceEntry; readonly space: SpaceView };

/**
 * The Finance Center.
 *
 * The page is built around one refusal: company money and personal money are
 * never added together. Everything below — totals, months, categories, anomalies
 * — is computed twice, once per side, and there is deliberately no combined
 * figure anywhere on the page for a reader to mistake for the truth.
 */
export default async function FinanceCenterPage() {
  const spaces = await loadSpaces();
  const rows = acrossSpaces(spaces, 'finance');
  const now = new Date();

  const companyRows = rows.filter((row) => row.space.kind === 'company');
  const personalRows = rows.filter((row) => row.space.kind === 'personal');

  const companies = spaces.filter((space) => space.kind === 'company');
  const personal = spaces.filter((space) => space.kind === 'personal');

  const company = buildView(companyRows, now);
  const life = buildView(personalRows, now);

  return (
    <>
      <PageHead
        eyebrow="Systems"
        title="Finance Center"
        lede="Every ledger you own, read across every space — kept in two halves that never meet."
        actions={
          <>
            <Badge tone="outline">{pluralise(companies.length, 'company', 'companies')}</Badge>
            <Badge tone="outline">{pluralise(rows.length, 'entry', 'entries')}</Badge>
          </>
        }
      />

      <Note tone="accent" icon="scale">
        <strong>Company money and personal money are never summed on this page.</strong> They have
        different owners, different tax treatment and different consequences when they are wrong, so
        a single combined figure would be an accurate description of nothing. The separation is
        structural: each half is computed from its own spaces and carries its own totals.
      </Note>

      <MoneySide
        title="Company money"
        blurb={`Consolidated across ${pluralise(companies.length, 'company workspace', 'company workspaces')}. Nothing personal is included.`}
        view={company}
        emptyHint="Create a company and its ledger appears here automatically."
      />

      <MoneySide
        title="Personal money"
        blurb={`${pluralise(personal.length, 'personal space')}. Nothing from any company is included.`}
        view={life}
        emptyHint="Personal entries recorded in Life show up here."
      />
    </>
  );
}

/* ------------------------------------------------------------ computation -- */

interface MonthCell {
  readonly key: string;
  readonly inMinor: number;
  readonly outMinor: number;
  readonly netMinor: number;
  readonly count: number;
}

interface CategoryTotal {
  readonly category: string;
  readonly totalMinor: number;
  readonly count: number;
}

interface SpaceTotal {
  readonly space: SpaceView;
  readonly inMinor: number;
  readonly outMinor: number;
  readonly netMinor: number;
  readonly count: number;
  readonly forecastCount: number;
}

interface Anomaly {
  readonly entry: FinanceEntry;
  readonly space: SpaceView;
  readonly medianMinor: number;
  readonly multiple: number;
  readonly sample: number;
}

interface SplitTotal {
  readonly recurringMinor: number;
  readonly recurringCount: number;
  readonly oneOffMinor: number;
  readonly oneOffCount: number;
}

interface MoneyView {
  readonly currency: CurrencyCode;
  /** True when the side holds more than one currency, so its totals are not comparable. */
  readonly mixedCurrency: boolean;
  readonly actualCount: number;
  readonly inMinor: number;
  readonly outMinor: number;
  readonly netMinor: number;
  readonly monthsWithActuals: number;
  readonly months: readonly MonthCell[];
  readonly series: readonly number[];
  readonly spaceTotals: readonly SpaceTotal[];
  readonly costCategories: readonly CategoryTotal[];
  readonly incoming: SplitTotal;
  readonly outgoing: SplitTotal;
  readonly anomalies: readonly Anomaly[];
  readonly testedCategories: number;
  readonly untestedCategories: number;
  readonly forecastInMinor: number;
  readonly forecastOutMinor: number;
  readonly forecastCount: number;
  readonly forecastMonths: number;
}

/** The last `count` calendar months, oldest first, as `YYYY-MM`. */
function recentMonthKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7));
  }
  return keys;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

function splitBy(rows: readonly LedgerRow[], direction: 'in' | 'out'): SplitTotal {
  let recurringMinor = 0;
  let recurringCount = 0;
  let oneOffMinor = 0;
  let oneOffCount = 0;
  for (const { item } of rows) {
    if (item.direction !== direction) continue;
    if (item.recurring) {
      recurringMinor += item.amount.amount;
      recurringCount += 1;
    } else {
      oneOffMinor += item.amount.amount;
      oneOffCount += 1;
    }
  }
  return { recurringMinor, recurringCount, oneOffMinor, oneOffCount };
}

function buildView(rows: readonly LedgerRow[], now: Date): MoneyView {
  const actuals = rows.filter((row) => row.item.confidence !== 'forecast');
  const forecasts = rows.filter((row) => row.item.confidence === 'forecast');

  const currencies = new Set(rows.map((row) => row.item.amount.currency));
  const currency = rows[0]?.item.amount.currency ?? 'CHF';

  let inMinor = 0;
  let outMinor = 0;
  for (const { item } of actuals) {
    if (item.direction === 'in') inMinor += item.amount.amount;
    else outMinor += item.amount.amount;
  }

  /* ---- months ---- */
  const cells = new Map<string, { inMinor: number; outMinor: number; count: number }>();
  for (const { item } of actuals) {
    const key = item.date.slice(0, 7);
    const cell = cells.get(key) ?? { inMinor: 0, outMinor: 0, count: 0 };
    if (item.direction === 'in') cell.inMinor += item.amount.amount;
    else cell.outMinor += item.amount.amount;
    cell.count += 1;
    cells.set(key, cell);
  }
  const months: MonthCell[] = recentMonthKeys(now, MONTHS_SHOWN).map((key) => {
    const cell = cells.get(key);
    return {
      key,
      inMinor: cell?.inMinor ?? 0,
      outMinor: cell?.outMinor ?? 0,
      netMinor: (cell?.inMinor ?? 0) - (cell?.outMinor ?? 0),
      count: cell?.count ?? 0,
    };
  });
  // Months with no entries are absent, not flat: feeding them to the rail as
  // zeroes would draw a collapse that never happened.
  const series = months.filter((month) => month.count > 0).map((month) => month.netMinor);

  /* ---- per space ---- */
  const bySpace = new Map<string, SpaceTotal>();
  for (const { item, space } of rows) {
    const current =
      bySpace.get(space.scopeKey) ??
      { space, inMinor: 0, outMinor: 0, netMinor: 0, count: 0, forecastCount: 0 };
    const forecast = item.confidence === 'forecast';
    bySpace.set(space.scopeKey, {
      space,
      inMinor: current.inMinor + (!forecast && item.direction === 'in' ? item.amount.amount : 0),
      outMinor: current.outMinor + (!forecast && item.direction === 'out' ? item.amount.amount : 0),
      netMinor: 0,
      count: current.count + (forecast ? 0 : 1),
      forecastCount: current.forecastCount + (forecast ? 1 : 0),
    });
  }
  const spaceTotals = [...bySpace.values()]
    .map((total) => ({ ...total, netMinor: total.inMinor - total.outMinor }))
    .sort((a, b) => b.inMinor - a.inMinor);

  /* ---- cost categories ---- */
  const byCategory = new Map<string, { totalMinor: number; count: number }>();
  for (const { item } of actuals) {
    if (item.direction !== 'out') continue;
    const current = byCategory.get(item.category) ?? { totalMinor: 0, count: 0 };
    byCategory.set(item.category, {
      totalMinor: current.totalMinor + item.amount.amount,
      count: current.count + 1,
    });
  }
  const costCategories = [...byCategory.entries()]
    .map(([category, total]) => ({ category, ...total }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  /* ---- anomalies ---- */
  // Keyed by space and by direction as well as by category. An inbound invoice
  // and an outbound cost filed under the same word are two different
  // populations, and one company's ordinary month is another's outlier — pooling
  // either would move the median far enough to hide the entry worth looking at.
  const populations = new Map<string, LedgerRow[]>();
  for (const row of actuals) {
    const key = `${row.space.scopeKey}:${row.item.direction}:${row.item.category}`;
    const list = populations.get(key);
    if (list) list.push(row);
    else populations.set(key, [row]);
  }

  const anomalies: Anomaly[] = [];
  let tested = 0;
  let untested = 0;
  for (const population of populations.values()) {
    if (population.length < MIN_CATEGORY_SAMPLE) {
      untested += 1;
      continue;
    }
    tested += 1;
    const mid = median(population.map((row) => row.item.amount.amount));
    if (mid === null || mid <= 0) continue;
    for (const row of population) {
      const multiple = row.item.amount.amount / mid;
      if (multiple <= ANOMALY_MULTIPLE) continue;
      anomalies.push({
        entry: row.item,
        space: row.space,
        medianMinor: Math.round(mid),
        multiple,
        sample: population.length,
      });
    }
  }
  anomalies.sort((a, b) => b.multiple - a.multiple);

  return {
    currency,
    mixedCurrency: currencies.size > 1,
    actualCount: actuals.length,
    inMinor,
    outMinor,
    netMinor: inMinor - outMinor,
    monthsWithActuals: cells.size,
    months,
    series,
    spaceTotals,
    costCategories,
    incoming: splitBy(actuals, 'in'),
    outgoing: splitBy(actuals, 'out'),
    anomalies,
    testedCategories: tested,
    untestedCategories: untested,
    forecastInMinor: forecasts
      .filter((row) => row.item.direction === 'in')
      .reduce((sum, row) => sum + row.item.amount.amount, 0),
    forecastOutMinor: forecasts
      .filter((row) => row.item.direction === 'out')
      .reduce((sum, row) => sum + row.item.amount.amount, 0),
    forecastCount: forecasts.length,
    forecastMonths: new Set(forecasts.map((row) => row.item.date.slice(0, 7))).size,
  };
}

/* ----------------------------------------------------------------- render -- */

function MoneySide({
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
