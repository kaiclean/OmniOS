/**
 * Panels for the business record: knowledge, CRM, finance (summary and ledger)
 * and risks.
 *
 * Server Components. Money is integer minor units, formatted only through
 * `lib/format.ts`; absence renders as `EMPTY`, never as a zero.
 */

import {
  EMPTY,
  daysBetween,
  formatDate,
  formatMinorAmount,
  formatNumber,
  pluralise,
} from '@/lib/format';
import { Badge, Empty, Metric, MetricGrid, Panel } from '@/components/ui/primitives';
import { scoped, type PanelProps, type SimplePanelProps } from './shared';

/* ------------------------------------------------------------- knowledge -- */

export function KnowledgePanel({ title, span, spec, ctx }: PanelProps) {
  const docs = scoped(ctx.data.docs, spec, ctx);
  return (
    <Panel title={title} span={span} flush>
      {docs.length === 0 ? (
        <Empty title="No documents">Decisions and processes recorded here become the AI&rsquo;s context.</Empty>
      ) : (
        <div className="list">
          {docs.map((doc) => (
            <div key={doc.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="spread">
                  <span className="list-primary">{doc.title}</span>
                  <Badge tone="outline">{doc.kind}</Badge>
                </span>
                <p className="prose">{doc.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------- crm -- */

const CRM_TONE = {
  lead: 'neutral',
  qualified: 'info',
  proposal: 'accent',
  won: 'ok',
  lost: 'deny',
  dormant: 'outline',
} as const;

export function CrmPanel({ title, span, spec, ctx }: PanelProps) {
  const contacts = scoped(
    ctx.data.contacts.map((c) => ({ ...c, capabilityId: 'sales' })),
    spec,
    ctx,
  );
  const open = contacts.filter((c) => !['won', 'lost', 'dormant'].includes(c.stage));
  const value = open.reduce((sum, c) => sum + (c.value?.amount ?? 0), 0);
  const currency = open[0]?.value?.currency ?? 'CHF';

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`${pluralise(open.length, 'open conversation')} · ${formatMinorAmount(value, currency, { compact: true })}`}
      flush
    >
      {contacts.length === 0 ? (
        <Empty title="No contacts yet" />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Stage</th>
                <th className="num">Value</th>
                <th>Next touch</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const overdue =
                  contact.nextTouchAt !== undefined && daysBetween(contact.nextTouchAt) > 0;
                return (
                  <tr key={contact.id}>
                    <td>
                      <div className="list-primary">{contact.name}</div>
                      <div className="list-secondary">
                        {contact.organisation ?? EMPTY}
                        {contact.role ? ` · ${contact.role}` : ''}
                      </div>
                    </td>
                    <td>
                      <Badge tone={CRM_TONE[contact.stage]}>{contact.stage}</Badge>
                    </td>
                    <td className="num">{formatMinorAmount(contact.value?.amount, currency, { compact: true })}</td>
                    <td>
                      {contact.nextTouchAt ? (
                        <span className={overdue ? 'delta--bad' : undefined}>
                          {formatDate(contact.nextTouchAt)}
                          {overdue ? ' · overdue' : ''}
                        </span>
                      ) : (
                        EMPTY
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- finance -- */

export function FinanceSummaryPanel({ title, span, ctx }: SimplePanelProps) {
  const entries = ctx.data.finance;
  const currency = entries[0]?.amount.currency ?? 'CHF';
  const actuals = entries.filter((e) => e.confidence !== 'forecast');
  const forecast = entries.filter((e) => e.confidence === 'forecast');

  const sum = (list: typeof entries, direction: 'in' | 'out') =>
    list.filter((e) => e.direction === direction).reduce((s, e) => s + e.amount.amount, 0);

  const revenue = sum(actuals, 'in');
  const costs = sum(actuals, 'out');
  const profit = revenue - costs;
  const months = new Set(actuals.map((e) => e.date.slice(0, 7))).size;
  const burn = months > 0 ? costs / months : 0;
  const runway = burn > 0 ? profit / burn : null;

  const byMonth = new Map<string, number>();
  for (const entry of actuals) {
    const key = entry.date.slice(0, 7);
    const delta = entry.direction === 'in' ? entry.amount.amount : -entry.amount.amount;
    byMonth.set(key, (byMonth.get(key) ?? 0) + delta);
  }
  const trend = [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v / 100);

  // An empty ledger is absence, not CHF 0 — a real company opens at an em dash
  // and earns its first number by recording it.
  const none = actuals.length === 0;
  return (
    <Panel
      title={title}
      span={span}
      subtitle={
        none
          ? 'No entries yet — the first recorded entry starts the position'
          : `${pluralise(months, 'month')} of actuals · ${forecast.length} forecast entries excluded`
      }
    >
      <MetricGrid>
        <Metric
          label="Revenue"
          value={none ? EMPTY : formatMinorAmount(revenue, currency, { compact: true })}
          hint={none ? 'nothing recorded' : pluralise(months, 'month')}
        />
        <Metric
          label="Costs"
          value={none ? EMPTY : formatMinorAmount(costs, currency, { compact: true })}
          hint={none ? 'nothing recorded' : pluralise(months, 'month')}
        />
        <Metric
          label="Net"
          value={none ? EMPTY : formatMinorAmount(profit, currency, { compact: true })}
          {...(none
            ? {}
            : { delta: { text: profit >= 0 ? 'positive' : 'negative', tone: profit >= 0 ? ('good' as const) : ('bad' as const) } })}
          series={trend}
          hint="Monthly net"
        />
        <Metric
          label="Runway at this burn"
          value={runway === null ? EMPTY : `${formatNumber(runway, 1)} mo`}
          hint={none ? 'no burn recorded' : `${formatMinorAmount(Math.round(burn), currency, { compact: true })}/mo`}
        />
      </MetricGrid>
    </Panel>
  );
}

export function FinanceLedgerPanel({ title, span, ctx }: SimplePanelProps) {
  const entries = [...ctx.data.finance].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);
  return (
    <Panel title={title} span={span} flush>
      {entries.length === 0 ? (
        <Empty title="No entries" />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Label</th>
                <th>Category</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.date)}</td>
                  <td>
                    <span className="list-primary">{entry.label}</span>
                    {entry.confidence !== 'actual' ? (
                      <span className="list-secondary"> · {entry.confidence}</span>
                    ) : null}
                  </td>
                  <td className="faint">{entry.category}</td>
                  <td className="num">
                    <span className={entry.direction === 'in' ? 'delta--good' : undefined}>
                      {entry.direction === 'in' ? '+' : '−'}
                      {formatMinorAmount(entry.amount.amount, entry.amount.currency, {
                        showCurrency: false,
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- risks -- */

const SEVERITY_TONE = { low: 'neutral', medium: 'warn', high: 'deny', critical: 'deny' } as const;

export function RisksPanel({ title, span, spec, ctx }: PanelProps) {
  const risks = scoped(ctx.data.risks, spec, ctx);
  return (
    <Panel title={title} span={span} flush>
      {risks.length === 0 ? (
        <Empty title="Nothing on the register">
          An empty risk register usually means nobody has looked, not that nothing is wrong.
        </Empty>
      ) : (
        <div className="list">
          {risks.map((risk) => (
            <div key={risk.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="spread">
                  <span className="list-primary">{risk.label}</span>
                  <span className="row" style={{ gap: 'var(--s-2)' }}>
                    <Badge tone="outline">{risk.kind}</Badge>
                    <Badge tone={SEVERITY_TONE[risk.severity]} dot>
                      {risk.severity}
                    </Badge>
                  </span>
                </span>
                <p className="prose">{risk.detail}</p>
                {risk.mitigation ? (
                  <p className="list-secondary">Mitigation — {risk.mitigation}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
