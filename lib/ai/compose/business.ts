/**
 * Composers for finance, strategy and growth.
 */

import { EMPTY, formatKpiValue, formatMinorAmount, pluralise } from '@/lib/format';
import { contactsOf, financeOf, goalsOf, kpisOf, risksOf } from '../context';
import type { ContextReferenceInput } from '../types';
import { blocks, bullet, position, ref, section, type Composer, type Position } from './helpers';

export const composeFinance: Composer = (ctx) => {
  const pos = position(ctx, 3);
  const references: ContextReferenceInput[] = [];

  const byCategory = new Map<string, number>();
  for (const e of financeOf(ctx)) {
    if (e.item.direction !== 'out' || e.item.confidence === 'forecast') continue;
    byCategory.set(e.item.category, (byCategory.get(e.item.category) ?? 0) + e.item.amount.amount);
  }
  const topCosts = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const monthlyBurn = pos.outMinor / pos.months;
  const monthlyIn = pos.inMinor / pos.months;
  const runwayMonths = monthlyBurn > 0 ? pos.netMinor / monthlyBurn : null;

  const financeKpis = kpisOf(ctx).filter((k) => k.item.capabilityId === 'finance');
  for (const k of financeKpis.slice(0, 3)) references.push(ref('kpi', k, k.item.label));

  const lines = [
    `In, last ${pos.months} months: ${formatMinorAmount(pos.inMinor, pos.currency)}`,
    `Out, last ${pos.months} months: ${formatMinorAmount(pos.outMinor, pos.currency)}`,
    `Net: ${formatMinorAmount(pos.netMinor, pos.currency)} (${formatMinorAmount(Math.round(monthlyIn - monthlyBurn), pos.currency)} per month)`,
  ];

  const costLines = topCosts.map(
    ([category, amount]) =>
      `${category} — ${formatMinorAmount(amount, pos.currency)} (${Math.round((amount / Math.max(1, pos.outMinor)) * 100)}% of spend)`,
  );

  const verdict =
    pos.netMinor >= 0
      ? runwayMonths !== null && runwayMonths < 6
        ? 'Positive, but thin. A single bad month would erase the buffer.'
        : 'Positive and holding. The buffer is real.'
      : 'Negative over the period. This is the number to fix before anything else gets funded.';

  const body = blocks([
    section(`Position (actuals only, forecasts excluded)`, bullet(lines)),
    section('Where it goes', costLines.length ? bullet(costLines) : '• No recorded spend.'),
    section('Read', verdict),
  ]);

  return {
    summary: `Reconciled ${pluralise(financeOf(ctx).length, 'ledger entry', 'ledger entries')} across ${pos.months} months.`,
    body,
    references,
    outputs: new Map([
      ['cfo', `Net ${formatMinorAmount(pos.netMinor, pos.currency)} over ${pos.months} months.`],
      ['analyst', topCosts.length ? `Largest cost line: ${topCosts[0]?.[0]}.` : 'No spend to analyse.'],
    ]),
  };
};

/** Performance Coach: recovery, and what it permits. */

export const composeStrategy: Composer = (ctx) => {
  const goals = goalsOf(ctx);
  const atRisk = goals.filter((g) => g.item.status === 'at-risk' || g.item.status === 'off-track');
  const risks = risksOf(ctx).sort((a, b) => severityRank(b.item.severity) - severityRank(a.item.severity));

  const body = blocks([
    section(
      'Goals',
      bullet(
        goals
          .slice(0, 5)
          .map(
            (g) =>
              `${g.item.title} — ${Math.round(g.item.progress * 100)}% · ${g.item.status}${ctx.slices.length > 1 ? ` · ${g.spaceLabel}` : ''}`,
          ),
      ) || '• No goals set.',
    ),
    section(
      'What would break the plan',
      bullet(risks.slice(0, 3).map((r) => `${r.item.label} (${r.item.severity}) — ${r.item.mitigation ?? 'no mitigation recorded'}`)) ||
        '• No risks recorded.',
    ),
    section(
      'Read',
      atRisk.length
        ? `${pluralise(atRisk.length, 'goal is', 'goals are')} not on track. The honest move is to cut one rather than run all of them at 60%.`
        : 'Everything tracked is on course. The risk register is where the attention belongs.',
    ),
  ]);

  return {
    summary: `Reviewed ${goals.length} goals and ${risks.length} risks.`,
    body,
    references: [
      ...goals.slice(0, 2).map((g) => ref('goal', g, g.item.title)),
      ...risks.slice(0, 2).map((r) => ref('risk', r, r.item.label)),
    ],
    outputs: new Map([
      ['strategist', atRisk.length ? `${atRisk.length} goals off track.` : 'Goals on track.'],
      ['analyst', `${risks.length} risks on the register.`],
    ]),
  };
};

const severityRank = (s: string): number => ({ critical: 4, high: 3, medium: 2, low: 1 })[s] ?? 0;

/** Sales / Marketing: pipeline and where attention is leaking. */
export const composeGrowth: Composer = (ctx) => {
  const contacts = contactsOf(ctx);
  const active = contacts.filter((c) => !['won', 'lost', 'dormant'].includes(c.item.stage));
  const stale = active.filter(
    (c) => c.item.nextTouchAt && new Date(c.item.nextTouchAt).getTime() < ctx.now.getTime(),
  );
  const pipelineMinor = active.reduce((sum, c) => sum + (c.item.value?.amount ?? 0), 0);
  const currency = active[0]?.item.value?.currency ?? 'CHF';
  const growthKpis = kpisOf(ctx).filter((k) => ['marketing', 'sales'].includes(k.item.capabilityId));

  const body = blocks([
    section(
      'Pipeline',
      bullet([
        `${pluralise(active.length, 'open conversation')} worth ${formatMinorAmount(pipelineMinor, currency)}`,
        `${pluralise(stale.length, 'is', 'are')} past the follow-up date you set`,
        `${pluralise(contacts.filter((c) => c.item.stage === 'won').length, 'deal')} won, ${contacts.filter((c) => c.item.stage === 'lost').length} lost`,
      ]),
    ),
    section(
      'Metrics',
      // A KPI armed but never measured has nothing to say — an em dash, never a
      // zero the founder might mistake for a measurement. Everything with a
      // value goes through the one formatter money and percentages share.
      bullet(
        growthKpis
          .slice(0, 4)
          .map(
            (k) =>
              `${k.item.label}: ${
                k.item.series.length <= 1 && k.item.value === 0 ? `${EMPTY} no data yet` : formatKpiValue(k.item)
              }`,
          ),
      ) || '• No growth metrics recorded.',
    ),
    section(
      'Read',
      stale.length
        ? `The leak is follow-up, not lead generation: ${stale.length} of ${active.length} open conversations are already past their date. ${stale[0]?.item.name} is the oldest.`
        : 'Follow-up is current. The constraint is upstream — more qualified conversations, not better chasing.',
    ),
  ]);

  return {
    summary: `Read ${contacts.length} contacts and ${growthKpis.length} growth metrics.`,
    body,
    references: stale.slice(0, 3).map((c) => ref('contact', c, c.item.name)),
    outputs: new Map([
      ['sales', `${active.length} open, ${stale.length} stale.`],
      ['marketer', 'Growth metrics read from this space only.'],
    ]),
  };
};

/** Operations / Automation: where work queues and what could stop being manual. */
