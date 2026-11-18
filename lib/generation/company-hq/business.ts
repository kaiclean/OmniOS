/**
 * Contacts, the finance ledger and risks.
 *
 * Money is integer minor units throughout.
 */

import { money, type Contact, type FinanceEntry, type RiskItem } from '@/lib/domain';
import { addDays, base, dayOnly, iso, type GenCtx } from './shared';

/* ------------------------------------------------------------------ crm --- */

export function makeContacts(ctx: GenCtx): Contact[] {
  const { rng, now, draft } = ctx;
  const seeds: ReadonlyArray<[string, string, string, Contact['stage']]> = [
    ['A. Brunner', 'Regional developer', 'Head of projects', 'proposal'],
    ['M. Keller', 'Facility group', 'Operations director', 'qualified'],
    ['S. Frei', 'Architecture practice', 'Partner', 'lead'],
    ['R. Odermatt', 'Municipal office', 'Procurement', 'qualified'],
    ['L. Bianchi', 'Property manager', 'Owner', 'won'],
    ['T. Wyss', 'General contractor', 'Site lead', 'lost'],
    ['N. Achermann', 'Private client', '—', 'dormant'],
  ];
  return seeds.map(([name, organisation, role, stage], i) => ({
    ...base(ctx, 'contact', `${i}:${name}`),
    name,
    organisation,
    role,
    stage,
    value: money(rng.int(4_000, 90_000) * 100, draft.baseCurrency),
    lastTouchAt: iso(addDays(now, -rng.int(2, 60))),
    nextTouchAt:
      stage === 'won' || stage === 'lost' ? undefined : iso(addDays(now, rng.int(-6, 18))),
    notes: '',
  }));
}

/* -------------------------------------------------------------- finance --- */

const EXPENSE_CATEGORIES = [
  'Salaries',
  'Subcontractors',
  'Tools & software',
  'Equipment',
  'Insurance',
  'Marketing',
  'Office & admin',
  'Travel',
];

export function makeFinance(ctx: GenCtx): FinanceEntry[] {
  const { rng, now, draft } = ctx;
  const entries: FinanceEntry[] = [];
  for (let monthsAgo = 8; monthsAgo >= -3; monthsAgo -= 1) {
    const monthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, Math.min(15, 28)),
    );
    const future = monthsAgo < 0;
    const confidence: FinanceEntry['confidence'] = future
      ? 'forecast'
      : monthsAgo === 0
        ? 'committed'
        : 'actual';

    const invoiceCount = rng.int(2, 5);
    for (let k = 0; k < invoiceCount; k += 1) {
      entries.push({
        ...base(ctx, 'fin', `in:${monthsAgo}:${k}`),
        date: dayOnly(new Date(monthDate.getTime() + k * 86_400_000 * 2)),
        direction: 'in',
        amount: money(rng.int(3_500, 26_000) * 100, draft.baseCurrency),
        category: rng.pick(['Project delivery', 'Retainer', 'Consulting', 'Maintenance']),
        label: `Invoice ${String(1000 + monthsAgo * 10 + k)}`,
        confidence,
        recurring: rng.bool(0.25),
        simulated: true,
      });
    }
    for (const category of rng.sample(EXPENSE_CATEGORIES, rng.int(4, 6))) {
      entries.push({
        ...base(ctx, 'fin', `out:${monthsAgo}:${category}`),
        date: dayOnly(new Date(monthDate.getTime() + 86_400_000)),
        direction: 'out',
        amount: money(rng.int(300, 14_000) * 100, draft.baseCurrency),
        category,
        label: category,
        confidence,
        recurring: ['Salaries', 'Insurance', 'Tools & software'].includes(category),
        simulated: true,
      });
    }
  }
  return entries;
}

/* ----------------------------------------------------------------- risks -- */

export function makeRisks(ctx: GenCtx): RiskItem[] {
  const seeds: ReadonlyArray<[string, string, RiskItem['severity'], RiskItem['kind'], string, string]> = [
    [
      'Revenue concentrated in too few clients',
      'A single client leaving would take the month with it.',
      'high',
      'risk',
      'sales',
      'Hold no client above 30% of monthly revenue; keep two conversations warm per active client.',
    ],
    [
      'Founder is in every delivery',
      'Nothing ships without one person, so nothing scales and nothing rests.',
      'high',
      'bottleneck',
      'operations',
      'Document the delivery SOP, then hand over one full delivery end to end.',
    ],
    [
      'Quoting is manual and inconsistent',
      'Prices vary by mood and memory, so margin is unpredictable.',
      'medium',
      'bottleneck',
      'finance',
      'Codify the pricing model, then automate the first-pass quote.',
    ],
    [
      'No written record of why decisions were made',
      'The same debates get re-run every quarter.',
      'medium',
      'risk',
      'strategy',
      'Record decisions as they happen; the Knowledge Base is the default place.',
    ],
    [
      'Marketing depends on referrals',
      'Referrals are a gift, not a channel, and they stop without warning.',
      'medium',
      'risk',
      'marketing',
      'Prove one repeatable channel before the referral flow softens.',
    ],
  ];
  return seeds.map(([label, detail, severity, kind, capabilityId, mitigation], i) => ({
    ...base(ctx, 'risk', `${i}:${label}`),
    label,
    detail,
    severity,
    kind,
    capabilityId,
    mitigation,
  }));
}
