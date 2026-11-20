'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { downloadOffertenExport, proposeOfferten } from '@/lib/actions/offerten';
import type { OffertenQuote, OffertenState } from '@/lib/offerten/schema';
import { EMPTY, formatMinorAmount, formatNumber, formatPercent } from '@/lib/format';
import { Badge, Empty, Metric, MetricGrid, Panel, SimulatedMark } from '@/components/ui/primitives';

type RunTool = (toolId: string, args: Record<string, unknown>) => void;

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const optionalNumber = (value: string): number | null => value === '' ? null : Number(value);
const minor = (value: string): number | null =>
  value === '' ? null : Math.round(Number(value) * 100);
const moneyInput = (value: number | null) => value === null ? '' : (value / 100).toFixed(2);

function completeTotal(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function OffertenReview({
  companyId, title, quotes, metrics, ingestReceipts, sendReceipts, exportCallId,
}: {
  companyId: string;
  title: string;
  quotes: readonly OffertenQuote[];
  metrics: OffertenState['metrics'];
  ingestReceipts: OffertenState['receipts'];
  sendReceipts: OffertenState['sends'];
  exportCallId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; awaitingApproval: boolean; summary: string } | null>(null);
  const [downloadCallId, setDownloadCallId] = useState(exportCallId);

  const run: RunTool = (toolId, args) => {
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await proposeOfferten(companyId, toolId, args);
        setOutcome(result);
        if (toolId === 'offerten.export' && result.ok && !result.awaitingApproval) {
          setDownloadCallId(result.toolCallId);
        }
        if (toolId === 'offerten.delete') setDownloadCallId(undefined);
      } catch {
        setOutcome({ ok: false, awaitingApproval: false, summary: 'The request failed. Refresh before retrying.' });
      }
    });
  };

  const download = () => {
    const callId = downloadCallId ?? exportCallId;
    if (!callId) return;
    startTransition(async () => {
      const result = await downloadOffertenExport(companyId, callId);
      if (!result.ok) {
        setOutcome({ ok: false, awaitingApproval: false, summary: result.message });
        return;
      }
      const url = URL.createObjectURL(new Blob([result.json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `offerten-${companyId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <div className="stack span-12">
      <Panel title={title} subtitle="Fixture-first · company-local · no real ERP or delivery connected">
        <div className="stack">
          <div className="row wrap">
            <SimulatedMark label="Generated / fixture workflow" />
            <Badge tone="outline">Founder review only</Badge>
            <Link href="/approvals" className="btn btn--ghost btn--sm">Open approvals</Link>
          </div>
          <p className="hint">
            Ingest and send wait for a recorded decision in the existing inbox or Telegram.
            Writes wait too when confirm writes is enabled. A fixture send records a local receipt only.
          </p>
          {ingestReceipts.map((receipt) => (
            <p className="hint" key={receipt.id}>
              <SimulatedMark label="Fixture readback" /> {formatNumber(receipt.quoteCount)} quotes ·{' '}
              {formatNumber(receipt.positionCount)} positions · {receipt.verified ? 'verified' : 'not verified'} · SHA-256{' '}
              <span style={{ overflowWrap: 'anywhere' }}>{receipt.sha256}</span>
            </p>
          ))}
          <div className="row wrap">
            <button type="button" className="btn btn--secondary" disabled={pending}
              onClick={() => run('offerten.ingest', {})}>Request fixture ingest</button>
            <button type="button" className="btn btn--ghost" disabled={pending}
              onClick={() => run('offerten.export', {})}>Prepare local export</button>
            {(downloadCallId ?? exportCallId) ? (
              <button type="button" className="btn btn--ghost" disabled={pending} onClick={download}>
                Download private export
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost" disabled={pending}
              onClick={() => run('offerten.delete', {})}>Request deletion</button>
          </div>
          <p className="hint">
            The export contains this company&apos;s private quote evidence and memory. Keep it local;
            it is not a customer document. Deletion does not erase backups or downloaded files.
          </p>
          {outcome ? (
            <p role={outcome.ok ? 'status' : 'alert'} className="row wrap">
              <Badge tone={outcome.awaitingApproval ? 'warn' : outcome.ok ? 'ok' : 'deny'}>
                {outcome.awaitingApproval ? 'Awaiting approval' : outcome.ok ? 'Recorded' : 'Not completed'}
              </Badge>
              <span className="hint">{outcome.summary}</span>
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Recorded owner-review metrics" subtitle="Generated fixture decisions, not real-pilot performance; missing measurements remain absent">
        <MetricGrid>
          <Metric label="Observations" value={formatNumber(metrics.observationCount)} />
          <Metric label="Owner acceptance rate"
            value={formatPercent(metrics.acceptanceRate === null ? null : metrics.acceptanceRate * 100)}
            hint="Recorded owner decisions only; not customer acceptance. At least three observations required." />
          <Metric label="Fixture workflow time saved" value={metrics.timeSavedMinutes == null ? EMPTY : `${formatNumber(metrics.timeSavedMinutes)}m`}
            hint="Owner-stated manual baseline minus clocked draft-to-approval time; not measured production-pilot savings." />
          <Metric label="Hand-calculation deviation"
            value={formatPercent(metrics.relativePriceDeviation === null ? null : metrics.relativePriceDeviation * 100, 1)}
            hint="Independent hand calculation versus agent price; only complete comparable inputs count." />
          <Metric label="Independent comparisons" value={formatNumber(metrics.handComparisonCount)} />
          <Metric label="Median hand deviation"
            value={formatPercent(metrics.handDeviationDistribution === null ? null : metrics.handDeviationDistribution.median * 100, 1)}
            hint="At least three independent line comparisons required." />
          <Metric label="P90 hand deviation"
            value={formatPercent(metrics.handDeviationDistribution === null ? null : metrics.handDeviationDistribution.p90 * 100, 1)}
            hint="Fixture-workflow distribution, not production accuracy." />
        </MetricGrid>
      </Panel>

      <DraftForm pending={pending} run={run} />

      {quotes.length === 0 ? (
        <Panel title="Quote review">
          <Empty title="No quotes yet">
            Request fixture ingest, approve it in the inbox, then create a draft below.
            A missing price stays absent until evidence or an owner edit supplies it.
          </Empty>
        </Panel>
      ) : quotes.map((quote) => (
        <QuoteReview key={`${quote.id}:${quote.revision}`} quote={quote} pending={pending} run={run}
          receipts={sendReceipts.filter((receipt) => receipt.quoteId === quote.id)} />
      ))}
    </div>
  );
}

function DraftForm({ pending, run }: { pending: boolean; run: RunTool }) {
  const [positionIds, setPositionIds] = useState([1]);
  return (
    <Panel title="Create a fixture draft" subtitle="No model request, live import or customer delivery">
      <form className="stack" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const vatRate = optionalNumber(field(form, 'vatRate'));
        const manualBaselineMinutes = optionalNumber(field(form, 'manualBaselineMinutes'));
        run('offerten.draft', {
          customer: field(form, 'customer'), site: field(form, 'site'),
          ...(field(form, 'date') ? { date: field(form, 'date') } : {}),
          currency: field(form, 'currency'), language: field(form, 'language'),
          ...(vatRate === null ? {} : { vatRate }),
          ...(manualBaselineMinutes === null ? {} : { manualBaselineMinutes }),
          positions: JSON.stringify(positionIds.map((id) => {
            const cost = minor(field(form, `cost:${id}`));
            const handPrice = minor(field(form, `handPrice:${id}`));
            return {
              description: field(form, `description:${id}`),
              quantity: optionalNumber(field(form, `quantity:${id}`)),
              unit: field(form, `unit:${id}`) || null,
              ...(cost === null ? {} : { cost }),
              ...(handPrice === null ? {} : { handPrice }),
            };
          })),
        });
      }}>
        <div className="grid">
          <label className="field span-6"><span className="label">Customer (fixture only)</span>
            <input className="input" name="customer" required maxLength={200} defaultValue="Fixture Customer" /></label>
          <label className="field span-6"><span className="label">Site</span>
            <input className="input" name="site" maxLength={200} defaultValue="Zurich" /></label>
          <label className="field span-4"><span className="label">Quote date</span>
            <input className="input" name="date" type="date" /></label>
          <label className="field span-4"><span className="label">Currency</span>
            <select className="select" name="currency" defaultValue="CHF">
              {['CHF', 'EUR', 'USD', 'GBP'].map((currency) => <option key={currency}>{currency}</option>)}
            </select></label>
          <label className="field span-4"><span className="label">Language (default de)</span>
            <input className="input" name="language" defaultValue="de" maxLength={20} /></label>
          <label className="field span-4"><span className="label">VAT rate (%) — unconfirmed</span>
            <input className="input" name="vatRate" type="number" min="0" max="100" step="0.01" placeholder="Unknown" /></label>
          <label className="field span-6"><span className="label">Measured manual baseline (minutes, optional)</span>
            <input className="input" name="manualBaselineMinutes" type="number" min="0.01" step="0.01" placeholder="Unmeasured" /></label>
        </div>
        {positionIds.map((id, index) => (
          <fieldset key={id} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className="label">Draft position {formatNumber(index + 1)}</legend>
            <div className="grid">
              <label className="field span-12"><span className="label">Position description</span>
                <input className="input" name={`description:${id}`} required maxLength={500}
                  defaultValue={id === 1 ? 'Maintenance cleaning' : ''} /></label>
              <label className="field span-6"><span className="label">Quantity</span>
                <input className="input" name={`quantity:${id}`} type="number" step="any" min="0.001" defaultValue="1" /></label>
              <label className="field span-6"><span className="label">Unit</span>
                <input className="input" name={`unit:${id}`} maxLength={30} defaultValue="hour" /></label>
              <label className="field span-6"><span className="label">Internal unit cost (major currency units)</span>
                <input className="input" name={`cost:${id}`} type="number" min="0" step="0.01" placeholder="Unknown" /></label>
              <label className="field span-6"><span className="label">Independent hand unit price (major currency units)</span>
                <input className="input" name={`handPrice:${id}`} type="number" min="0" step="0.01" placeholder="Not yet calculated" /></label>
            </div>
            <div><button type="button" className="btn btn--ghost btn--sm"
              disabled={pending || positionIds.length === 1}
              onClick={() => setPositionIds((current) => current.filter((entry) => entry !== id))}>
              Remove position {formatNumber(index + 1)}
            </button></div>
          </fieldset>
        ))}
        <div><button type="button" className="btn btn--secondary btn--sm"
          disabled={pending || positionIds.length >= 20}
          onClick={() => setPositionIds((current) => [...current, Math.max(...current) + 1])}>
          Add position
        </button></div>
        <p className="hint">Up to 20 draft positions per form. Removing a draft row does not change any saved quote.</p>
        <p className="hint">
          CHF and German are fixture defaults, not confirmed customer policy. Blank VAT is unknown.
          Prices are stored as integer minor units; this form uses two decimal places. No VAT-inclusive total is claimed.
          Elapsed review time is clocked from draft creation to approval, never supplied by a model or this form.
        </p>
        <div><button className="btn btn--primary" disabled={pending} type="submit">
          {pending ? 'Working…' : 'Create generated draft'}
        </button></div>
      </form>
    </Panel>
  );
}

function QuoteReview({ quote, pending, run, receipts }: {
  quote: OffertenQuote; pending: boolean; run: RunTool; receipts: OffertenState['sends'];
}) {
  const currency = quote.header.currency;
  const money = (value: number | null | undefined) =>
    currency === null ? EMPTY : formatMinorAmount(value, currency, { exact: true });
  const revenue = quote.internal.totalRevenue;
  const handTotal = completeTotal(quote.positions.map((position) =>
    position.quantity === null || position.handPrice === null ? null : Math.round(position.quantity * position.handPrice)));
  const cost = quote.internal.totalCost;
  const margin = quote.internal.totalMargin;

  return (
    <div id={`offerte-${quote.id}-revision-${quote.revision}`}>
    <Panel title={`${quote.header.customer ?? EMPTY} · revision ${formatNumber(quote.revision)}`}
      subtitle={`${quote.header.site || EMPTY} · ${quote.header.date || EMPTY}`}
      action={<SimulatedMark />}>
      <div className="stack">
        <div className="row wrap">
          <Badge>{quote.header.status}</Badge>
          <Badge tone="outline">Send bound to this revision</Badge>
          <a className="btn btn--ghost btn--sm" href={`#offerte-${quote.id}-revision-${quote.revision}`}>
            Link to this review revision
          </a>
          {quote.sentRevision !== null ? <Badge>Fixture receipt · revision {formatNumber(quote.sentRevision)}</Badge> : null}
        </div>
        <h3 className="section-title">Customer-facing positions</h3>
        <div className="table-scroll">
          <table className="table">
            <caption className="hint">Three-way unit-price comparison · deviation = agent minus hand calculation</caption>
            <thead><tr>
              <th>Position / public reason</th><th className="num">Quantity</th>
              <th className="num">Agent</th><th className="num">Hand calculation</th><th className="num">Deviation</th>
            </tr></thead>
            <tbody>{quote.positions.map((position) => (
              <tr key={position.id}>
                <td>{position.description}<div className="hint">{position.reason.text || EMPTY}</div>
                  {position.reason.appliesBecause && position.reason.appliesBecause !== position.reason.text
                    ? <div className="hint">{position.reason.appliesBecause}</div> : null}
                  <div className="hint">Source: {position.reason.source
                    ? `${position.reason.source.kind} · ${position.reason.source.id}` : EMPTY}
                    {' · '}Nearest comparable deviation: {money(position.reason.nearestComparableDelta)}</div>
                </td>
                <td className="num">{formatNumber(position.quantity, 2)} {position.unit ?? EMPTY}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{money(position.unitPrice)}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{money(position.handPrice)}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{money(position.unitPrice === null || position.handPrice === null
                  ? null : position.unitPrice - position.handPrice)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="hint">Hand calculations and deviations above are founder review aids, not part of the customer document.</p>
        <details>
          <summary className="label">Customer document preview — no internal figures</summary>
          <pre className="hint" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(quote.documents.customer, null, 2)}
          </pre>
        </details>

        <h3 className="section-title">Internal calculation — local only</h3>
        <MetricGrid>
          <Metric label="Revenue, before VAT" value={money(revenue)} />
          <Metric label="Independent hand total" value={money(handTotal)} />
          <Metric label="Internal cost" value={money(cost)} />
          <Metric label="Margin amount" value={money(margin)}
            hint={revenue === null || revenue === 0 || margin === null ? 'Missing inputs; no margin rate.' : formatPercent(margin / revenue * 100, 1)} />
        </MetricGrid>
        <p className="hint">A total is absent if any position lacks its required inputs. Private costs, owner explanations and memory never become customer reasons.</p>
        <div className="table-scroll">
          <table className="table">
            <caption className="hint">Private unit economics and owner commentary</caption>
            <thead><tr><th>Position</th><th className="num">Unit cost</th><th className="num">Unit margin</th><th>Internal commentary</th></tr></thead>
            <tbody>{quote.internal.positions.map((position) => (
              <tr key={position.positionId}>
                <td>{quote.positions.find((item) => item.id === position.positionId)?.description ?? EMPTY}
                  <div className="hint" style={{ overflowWrap: 'anywhere' }}>
                    Historical quote (private): {quote.positions.find((item) => item.id === position.positionId)?.sourceQuoteId ?? EMPTY}
                  </div>
                </td>
                <td className="num">{money(position.cost)}</td>
                <td className="num">{money(position.margin)}</td>
                <td>{position.commentary || EMPTY}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {quote.internal.notes.map((note, index) => <p className="hint" key={index}>{note}</p>)}

        <form className="stack" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run('offerten.edit', {
            quoteId: quote.id,
            edits: JSON.stringify({
              expectedRevision: quote.revision,
              positions: quote.positions.map((position) => {
                const reason = field(form, `reason:${position.id}`);
                return {
                  id: position.id,
                  quantity: optionalNumber(field(form, `quantity:${position.id}`)),
                  unitPrice: minor(field(form, `price:${position.id}`)),
                  handPrice: minor(field(form, `hand:${position.id}`)),
                  ...(reason ? { reason: { code: 'owner-edited', text: reason } } : {}),
                };
              }),
            }),
          });
        }}>
          <h3 className="section-title">Owner edits</h3>
          {quote.positions.map((position) => (
            <fieldset key={position.id} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="label">{position.description}</legend>
              <div className="grid">
                <label className="field span-4"><span className="label">Quantity</span>
                  <input className="input" type="number" min="0.001" step="any" name={`quantity:${position.id}`}
                    defaultValue={position.quantity ?? ''} placeholder="Unknown" /></label>
                <label className="field span-4"><span className="label">Unit price ({currency ?? EMPTY})</span>
                  <input className="input" type="number" min="0" step="0.01" name={`price:${position.id}`}
                    defaultValue={moneyInput(position.unitPrice)} placeholder="Unknown" /></label>
                <label className="field span-4"><span className="label">Hand unit price ({currency ?? EMPTY})</span>
                  <input className="input" type="number" min="0" step="0.01" name={`hand:${position.id}`}
                    defaultValue={moneyInput(position.handPrice)} placeholder="Not yet calculated" /></label>
                <label className="field span-12"><span className="label">Private owner reason / correction</span>
                  <textarea className="textarea" name={`reason:${position.id}`} maxLength={1000}
                    placeholder="Internal only. Customer receives a fixed, safe reason label." /></label>
              </div>
            </fieldset>
          ))}
          <div><button className="btn btn--secondary" disabled={pending} type="submit">
            Save revision-bound edits
          </button></div>
          <p className="hint">Concurrent or stale edits are refused. Any edit requires a new send request for the new revision.</p>
        </form>
        <div className="row wrap">
          <button type="button" className="btn btn--ghost" disabled={pending}
            onClick={() => run('offerten.compare', { quoteId: quote.id })}>Record comparison</button>
          <button type="button" className="btn btn--ghost" disabled={pending}
            onClick={() => run('offerten.update_memory', { quoteId: quote.id })}>Update private quote memory</button>
          <button type="button" className="btn btn--secondary" disabled={pending}
            onClick={() => run('offerten.send', { quoteId: quote.id, revision: quote.revision })}>
            Request fixture send · revision {formatNumber(quote.revision)}
          </button>
        </div>
        {receipts.map((receipt) => (
          <div className="stack" key={receipt.id} id={`offerte-receipt-${receipt.id}`}>
            <p className="hint"><SimulatedMark label="Local fixture receipt" /> Revision {formatNumber(receipt.revision)} · decision recorded by {receipt.decidedBy} · {receipt.decidedAt}</p>
            <p className="hint" style={{ overflowWrap: 'anywhere' }}>
              Customer document SHA-256: {receipt.documentHash}. No external message was sent.
            </p>
            <details>
              <summary className="label">Immutable approved customer package · revision {formatNumber(receipt.revision)}</summary>
              <pre className="hint" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {JSON.stringify(receipt.document, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </div>
    </Panel>
    </div>
  );
}
