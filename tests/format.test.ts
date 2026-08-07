import { describe, expect, it } from 'vitest';

import {
  EMPTY,
  daysBetween,
  deltaOf,
  formatDate,
  formatDurationMinutes,
  formatKpiValue,
  formatMinorAmount,
  formatMoney,
  formatNumber,
  formatPercent,
  initials,
  pluralise,
} from '@/lib/format';

/**
 * The rule these tests exist to protect: a missing value renders as an em dash,
 * never as zero. A founder has to be able to trust that every number on screen
 * was derived from something.
 */
describe('absence', () => {
  it('never substitutes zero for a missing value', () => {
    expect(formatNumber(undefined)).toBe(EMPTY);
    expect(formatNumber(null)).toBe(EMPTY);
    expect(formatNumber(Number.NaN)).toBe(EMPTY);
    expect(formatMoney(null)).toBe(EMPTY);
    expect(formatMinorAmount(undefined, 'CHF')).toBe(EMPTY);
    expect(formatPercent(undefined)).toBe(EMPTY);
    expect(formatDurationMinutes(undefined)).toBe(EMPTY);
    expect(formatDate(undefined)).toBe(EMPTY);
    expect(formatDate('not a date')).toBe(EMPTY);
  });

  it('still renders a genuine zero', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('money', () => {
  // Grouping is the Swiss apostrophe, because that is what the founder reads.
  it('treats amounts as integer minor units', () => {
    expect(formatMoney({ amount: 123_456, currency: 'CHF' })).toBe("CHF 1'235");
    expect(formatMoney({ amount: 100, currency: 'EUR' })).toBe('EUR 1');
  });

  it('compacts large amounts', () => {
    expect(formatMoney({ amount: 4_500_000, currency: 'CHF' }, { compact: true })).toBe('CHF 45K');
  });

  it('can drop the currency for tables that carry it in the header', () => {
    expect(formatMoney({ amount: 100_000, currency: 'USD' }, { showCurrency: false })).toBe("1'000");
  });

  it('handles negatives', () => {
    expect(formatMoney({ amount: -250_000, currency: 'CHF' })).toContain("2'500");
  });
});

describe('kpi values', () => {
  it('formats each kpi kind in its own units', () => {
    expect(formatKpiValue({ value: 42, format: 'number' })).toBe('42');
    expect(formatKpiValue({ value: 42.5, format: 'percent' })).toBe('42.5%');
    expect(formatKpiValue({ value: 90, format: 'duration-minutes' })).toBe('1.5h');
    expect(formatKpiValue({ value: 75, format: 'score' })).toBe('75');
    // A KPI's money value is in major units; compaction only kicks in above 10k.
    expect(formatKpiValue({ value: 1200, format: 'money', currency: 'CHF' })).toBe("CHF 1'200");
    expect(formatKpiValue({ value: 48_000, format: 'money', currency: 'CHF' })).toBe('CHF 48K');
  });
});

describe('deltas', () => {
  it('interprets direction rather than just sign', () => {
    expect(deltaOf({ value: 110, previousValue: 100, direction: 'up-good' }).tone).toBe('good');
    expect(deltaOf({ value: 110, previousValue: 100, direction: 'down-good' }).tone).toBe('bad');
    expect(deltaOf({ value: 90, previousValue: 100, direction: 'down-good' }).tone).toBe('good');
  });

  it('reports an unknown baseline rather than inventing 100%', () => {
    expect(deltaOf({ value: 10, direction: 'up-good' }).text).toBe(EMPTY);
    expect(deltaOf({ value: 10, previousValue: 0, direction: 'up-good' }).text).toBe(EMPTY);
  });

  it('treats sub-half-percent movement as flat', () => {
    const delta = deltaOf({ value: 100.2, previousValue: 100, direction: 'up-good' });
    expect(delta.tone).toBe('flat');
    expect(delta.text).toBe('0%');
  });

  it('uses a true minus sign, not a hyphen', () => {
    expect(deltaOf({ value: 80, previousValue: 100, direction: 'up-good' }).text).toContain('−');
  });
});

describe('durations', () => {
  it('scales its unit to the magnitude', () => {
    expect(formatDurationMinutes(45)).toBe('45m');
    expect(formatDurationMinutes(90)).toBe('1.5h');
    expect(formatDurationMinutes(600)).toBe('10h');
    expect(formatDurationMinutes(4320)).toBe('3d');
  });
});

describe('dates', () => {
  it('counts whole days between two points', () => {
    expect(daysBetween('2026-03-01T00:00:00Z', new Date('2026-03-08T00:00:00Z'))).toBe(7);
    expect(daysBetween('2026-03-08T00:00:00Z', new Date('2026-03-01T00:00:00Z'))).toBe(-7);
  });
});

describe('text', () => {
  it('pluralises with the count attached', () => {
    expect(pluralise(1, 'task')).toBe('1 task');
    expect(pluralise(3, 'task')).toBe('3 tasks');
    expect(pluralise(2, 'person', 'people')).toBe('2 people');
  });

  it('takes at most two initials', () => {
    expect(initials('Kai Lienhard')).toBe('KL');
    expect(initials('Meridian Build Holdings')).toBe('MB');
    expect(initials('')).toBe('');
  });
});
