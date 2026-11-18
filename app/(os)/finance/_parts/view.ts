/**
 * The Finance Center's computation: month cells, category totals, anomalies and the
 * per-side view. Pure functions over ledger rows; company and personal money are
 * never combined here.
 */

import type { SpaceView } from '@/lib/data/aggregate';
import type { CurrencyCode, FinanceEntry } from '@/lib/domain';

/** Months drawn in the net-by-month view. */
export const MONTHS_SHOWN = 12;

/** An entry this many times its category median is worth a founder's second look. */
export const ANOMALY_MULTIPLE = 2.5;

/**
 * Below this many entries a median is an artefact of the sample, not a norm — a
 * category with two rows would flag the larger one every time. Untested
 * categories are counted and named in the UI rather than silently skipped.
 */
export const MIN_CATEGORY_SAMPLE = 4;

type LedgerRow = { readonly item: FinanceEntry; readonly space: SpaceView };

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

export interface SplitTotal {
  readonly recurringMinor: number;
  readonly recurringCount: number;
  readonly oneOffMinor: number;
  readonly oneOffCount: number;
}

export interface MoneyView {
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

export function median(values: readonly number[]): number | null {
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

export function buildView(rows: readonly LedgerRow[], now: Date): MoneyView {
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
