/**
 * Formatting.
 *
 * One rule runs through all of it: when a value is absent, render an em dash —
 * never a zero, never a guess. A founder has to be able to trust that every
 * number on screen was actually derived from something.
 */

import type { CurrencyCode, Kpi, Money } from '@/lib/domain';
import { CURRENCY_MINOR_UNITS } from '@/lib/domain';

export const EMPTY = '—';

/**
 * `Intl.*Format` construction is expensive enough to matter when a page renders a
 * few hundred metrics, so instances are memoised per configuration.
 */
const formatterCache = new Map<string, unknown>();

function cached<T>(key: string, make: () => T): T {
  const existing = formatterCache.get(key);
  if (existing) return existing as T;
  const created = make();
  formatterCache.set(key, created);
  return created;
}

const formatter = (key: string, make: () => Intl.NumberFormat): Intl.NumberFormat =>
  cached(`n:${key}`, make);

const dateFormatter = (key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat =>
  cached(`d:${key}`, make);

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  return formatter(`n:${decimals}`, () =>
    new Intl.NumberFormat('en-CH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  ).format(value);
}

export function formatMoney(
  money: Money | null | undefined,
  options: { compact?: boolean; showCurrency?: boolean } = {},
): string {
  if (!money) return EMPTY;
  const units = CURRENCY_MINOR_UNITS[money.currency] ?? 100;
  const major = money.amount / units;
  const { compact = false, showCurrency = true } = options;
  const body = formatter(`m:${compact}`, () =>
    new Intl.NumberFormat('en-CH', {
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 0,
    }),
  ).format(major);
  return showCurrency ? `${money.currency} ${body}` : body;
}

export function formatMinorAmount(
  amount: number | null | undefined,
  currency: CurrencyCode,
  options: { compact?: boolean; showCurrency?: boolean } = {},
): string {
  if (amount === null || amount === undefined) return EMPTY;
  return formatMoney({ amount, currency }, options);
}

export function formatPercent(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  return `${formatNumber(value, decimals)}%`;
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return EMPTY;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${formatNumber(hours, hours < 10 && hours % 1 !== 0 ? 1 : 0)}h`;
  const days = hours / 24;
  return `${formatNumber(days, days % 1 === 0 ? 0 : 1)}d`;
}

export function formatKpiValue(kpi: Pick<Kpi, 'value' | 'format' | 'currency'>): string {
  switch (kpi.format) {
    case 'money':
      return formatMinorAmount(Math.round(kpi.value * 100), kpi.currency ?? 'CHF', {
        compact: Math.abs(kpi.value) >= 10_000,
      });
    case 'percent':
      return formatPercent(kpi.value, kpi.value % 1 === 0 ? 0 : 1);
    case 'duration-minutes':
      return formatDurationMinutes(kpi.value);
    case 'score':
      return formatNumber(kpi.value, 0);
    case 'number':
    default:
      return formatNumber(kpi.value, kpi.value % 1 === 0 ? 0 : 1);
  }
}

/** Signed change with the direction already interpreted as good or bad. */
export function deltaOf(
  kpi: Pick<Kpi, 'value' | 'previousValue' | 'direction'>,
): { text: string; tone: 'good' | 'bad' | 'flat' } {
  if (kpi.previousValue === undefined || kpi.previousValue === 0) {
    return { text: EMPTY, tone: 'flat' };
  }
  const change = ((kpi.value - kpi.previousValue) / Math.abs(kpi.previousValue)) * 100;
  if (Math.abs(change) < 0.5) return { text: '0%', tone: 'flat' };
  const rising = change > 0;
  const good =
    kpi.direction === 'neutral' ? 'flat' : (kpi.direction === 'up-good') === rising ? 'good' : 'bad';
  return {
    text: `${rising ? '+' : '−'}${formatNumber(Math.abs(change), Math.abs(change) < 10 ? 1 : 0)}%`,
    tone: good as 'good' | 'bad' | 'flat',
  };
}

/* ---------------------------------------------------------------- dates --- */

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return EMPTY;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY;
  return dateFormatter('short', () =>
    new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }),
  ).format(date);
}

export function formatDateLong(value: string | Date | null | undefined): string {
  if (!value) return EMPTY;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY;
  return dateFormatter('long', () =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  ).format(date);
}

export function formatTimeOfDay(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "3 days ago" / "in 2 weeks" — relative time without a dependency. */
export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return EMPTY;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY;
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const units: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'minute') {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
        Math.round(diffMs / ms),
        unit,
      );
    }
  }
  return 'just now';
}

export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const from = typeof a === 'string' ? new Date(a) : a;
  const to = typeof b === 'string' ? new Date(b) : b;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/* ----------------------------------------------------------------- text --- */

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
