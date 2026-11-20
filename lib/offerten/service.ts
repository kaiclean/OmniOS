import 'server-only';

/**
 * A fixture-only, company-local quote workflow. Each publication writes one
 * scoped state and its rule index together, reads them back, and rolls both back
 * if verification fails. No provider, ERP connection or delivery client lives
 * here. A send is an immutable local customer-document package, never delivery.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { CompanyScope, MemoryRecord, Scope, ToolArgs, ToolCall, ToolContext, ToolOutcome } from '@/lib/domain';
import { scopeKey, scopesEqual } from '@/lib/domain';
import { isOffertenRecord } from '@/lib/domain/local-only';
import { dataDir } from '@/lib/data/data-dir';
import { mutateScope, readScope } from '@/lib/data/store';
import { COLLECTION_NAMES } from '@/lib/data/schema';
import type { ScopeData } from '@/lib/data/schema';
import { recallMemory } from '@/lib/ai/recall';
import type {
  ConnectorConfig, IngestReceipt, OffertenComparison, OffertenEdit, OffertenExport, OffertenMetrics,
  OffertenObservation, OffertenQuote, OffertenRule, OffertenState,
} from './schema';
import {
  ConnectorConfigSchema, CostMasterSchema, IngestReceiptSchema, OffertenEditSchema, OffertenQuoteSchema,
  OffertenRuleSchema, PositionInputSchema, QuoteHeaderSchema,
} from './schema';
import type { OffertenAdapter } from './adapter';
import { fixtureAdapter } from './adapter';
import { activeRule, comparison, completeInternalSheet, customerDocument, lineTotal, pricePositions, safeReason } from './pricing';

export type OffertenOutcome = ToolOutcome & { quote?: OffertenQuote; receipt?: IngestReceipt };
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const idFor = (prefix: string, value: unknown) => `${prefix}-${hash(value).slice(0, 24)}`;
// Lexical recall drops short words and units; this token keeps exact evidence reachable.
const positionRecallKey = (description: string, unit: string | null, currency: string | null) =>
  `offertenexact${hash([
    description.trim().toLowerCase().replace(/\s+/g, ' '),
    unit?.trim().toLowerCase().replace(/\s+/g, ' ') ?? null, currency,
  ])}`;
const lanes = new Map<string, Promise<unknown>>();
const privateMemory = (record: MemoryRecord) => isOffertenRecord(record);

interface OffertenIndexRecord extends MemoryRecord {
  offertenSource: { quoteId?: string; positionId?: string; ruleId?: string };
  expires: string;
  established: string;
}

function company(scope: Scope): CompanyScope {
  if (scope.kind !== 'company' || !scope.companyId) throw new Error('Offerten is available only in a company scope.');
  return scope;
}

function initialState(scope: CompanyScope): OffertenState {
  return {
    id: idFor('offerten', scopeKey(scope)), scope, generated: true,
    connector: ConnectorConfigSchema.parse({}),
    quotes: [], catalogue: [], receipts: [], sends: [], rules: [], audit: [],
    metrics: metrics([]), memoryHash: null, observations: [], memoryRetentionDays: 365, costMasters: [],
  };
}

function metrics(observations: OffertenObservation[]): OffertenMetrics {
  if (observations.length === 0) return {
    observationCount: null, acceptanceRate: null, timeSavedMinutes: null, priceDeviation: null,
    approvedAsDrafted: null, approvedEdited: null, rejected: null, relativePriceDeviation: null,
    handComparisonCount: null, handDeviationDistribution: null,
  };
  const approvedAsDrafted = observations.filter((entry) => entry.decision === 'approved-as-drafted').length;
  const approvedEdited = observations.filter((entry) => entry.decision === 'approved-edited').length;
  const rejected = observations.filter((entry) => entry.decision === 'rejected').length;
  const priced = observations.filter((entry) => entry.quoteHandDeviation !== null);
  const relative = observations.filter((entry) => entry.quoteHandRelativeDeviation !== null);
  const timed = observations.filter((entry) => entry.decision !== 'rejected' &&
    entry.baselineMinutes !== null && entry.intakeMinutes !== null);
  const currencies = new Set(observations.map((entry) => entry.currency));
  const handComparisons = observations.flatMap((entry) => entry.positions)
    .map((entry) => entry.handRelativeDeviation)
    .filter((entry): entry is number => entry !== null && Number.isFinite(entry))
    .map(Math.abs).sort((a, b) => a - b);
  const middle = Math.floor(handComparisons.length / 2);
  return {
    observationCount: observations.length,
    acceptanceRate: observations.length < 3 ? null : (approvedAsDrafted + approvedEdited) / observations.length,
    approvedAsDrafted, approvedEdited, rejected,
    priceDeviation: priced.length && currencies.size === 1 && !currencies.has(null)
      ? Math.round(priced.reduce((sum, entry) => sum + Math.abs(entry.quoteHandDeviation!), 0) / priced.length) : null,
    relativePriceDeviation: relative.length ? relative.reduce((sum, entry) => sum + Math.abs(entry.quoteHandRelativeDeviation!), 0) / relative.length : null,
    timeSavedMinutes: timed.length ? timed.reduce((sum, entry) => sum + entry.baselineMinutes! - entry.intakeMinutes!, 0) / timed.length : null,
    handComparisonCount: handComparisons.length || null,
    handDeviationDistribution: handComparisons.length < 3 ? null : {
      n: handComparisons.length,
      median: handComparisons.length % 2 ? handComparisons[middle]! : (handComparisons[middle - 1]! + handComparisons[middle]!) / 2,
      p90: handComparisons[Math.ceil(handComparisons.length * 0.9) - 1]!,
    },
  };
}

export function offertenMemoryPath(scope: Scope): string {
  const owned = company(scope);
  return join(dataDir(), 'offerten', `company-${hash(owned.companyId).slice(0, 32)}`, 'memory', 'offerten.md');
}

function escapeCell(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('|', '&#124;').replaceAll('\n', '&#10;').replaceAll('\r', '');
}

export function renderOffertenMemory(rules: OffertenRule[]): string {
  const rows = rules.map((rule) => [
    rule.id, rule.tag, rule.pricing ? JSON.stringify({ fact: rule.fact, pricing: rule.pricing }) : rule.fact,
    rule.established, rule.expires, rule.source,
  ].map(escapeCell).join(' | '));
  return [
    '# Offerten memory — generated, company-local internal rules',
    '',
    '| id | tag | fact | established | expires | source |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}

async function optionalRead(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function verifiedFileWrite(path: string, content: string): Promise<void> {
  const parent = join(path, '..');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const pending = `${path}.pending`;
  try {
    await writeFile(pending, content, { encoding: 'utf8', mode: 0o600 });
    if (await readFile(pending, 'utf8') !== content) throw new Error('Offerten memory staging verification failed.');
    await rename(pending, path);
    if (hash(await readFile(path, 'utf8')) !== hash(content)) throw new Error('Offerten memory read-back verification failed.');
  } finally { await rm(pending, { force: true }); }
}

function fromData(scope: CompanyScope, records: OffertenState[]): OffertenState {
  const stored = records[0];
  if (!stored) return initialState(scope);
  if (!scopesEqual(scope, stored.scope) || records.length !== 1) throw new Error('Offerten scope verification failed.');
  return {
    ...stored,
    connector: ConnectorConfigSchema.parse(stored.connector),
    quotes: stored.quotes.map((quote) => OffertenQuoteSchema.parse(quote)),
    catalogue: stored.catalogue.map((quote) => OffertenQuoteSchema.parse(quote)),
    rules: stored.rules.map((rule) => OffertenRuleSchema.parse(rule)),
    observations: stored.observations ?? [],
    memoryRetentionDays: stored.memoryRetentionDays ?? 365,
    costMasters: (stored.costMasters ?? []).map((entry) => CostMasterSchema.parse(entry)),
  };
}

async function verifyMemory(state: OffertenState): Promise<string> {
  const content = await optionalRead(offertenMemoryPath(state.scope));
  const expected = renderOffertenMemory(state.rules);
  if (state.memoryHash !== null && (content === null || hash(content) !== state.memoryHash || content !== expected)) {
    throw new Error('Offerten memory read-back does not match the recorded rules.');
  }
  return content ?? expected;
}

export async function getOffertenState(scope: Scope): Promise<OffertenState> {
  const owned = company(scope);
  const data = await readScope(owned);
  const state = fromData(owned, data.offerten);
  await verifyMemory(state);
  return { ...state, metrics: metrics(state.observations) };
}

async function serial<T>(scope: CompanyScope, work: () => Promise<T>): Promise<T> {
  const key = `${dataDir()}:${scopeKey(scope)}`;
  const previous = lanes.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  lanes.set(key, current);
  try { return await current; }
  finally { if (lanes.get(key) === current) lanes.delete(key); }
}

function indexedRules(state: OffertenState, at: string): OffertenIndexRecord[] {
  const now = new Date(at);
  const rules: OffertenIndexRecord[] = state.rules.filter((rule) => activeRule(rule, now)).map((rule) => ({
    id: idFor('offerten-rule', [scopeKey(state.scope), rule.id]),
    scope: state.scope, kind: 'pattern',
    text: `${rule.tag}: ${rule.fact} ${rule.pricing?.description ?? ''} ${rule.pricing?.unit ?? ''} ${
      rule.pricing ? positionRecallKey(rule.pricing.description, rule.pricing.unit, rule.pricing.currency) : ''
    }`,
    capabilityId: 'offerten', strength: 1, tags: ['offerten', 'offerten-internal', rule.id],
    source: 'observation', useCount: 0,
    createdAt: rule.established, updatedAt: at,
    offertenSource: { ruleId: rule.id }, expires: rule.expires, established: rule.established,
  }));
  const positions: OffertenIndexRecord[] = state.catalogue
    .filter((quote) => !['draft', 'rejected'].includes(quote.header.status))
    .flatMap((quote) => quote.positions.map((position) => ({
      id: idFor('offerten-position', [scopeKey(state.scope), quote.id, quote.revision, position.id]),
      scope: state.scope, kind: 'fact' as const,
      text: `${position.description} ${position.unit ?? ''} ${quote.header.currency ?? ''} ${quote.header.customer ?? ''} ${quote.header.site ?? ''} ${
        positionRecallKey(position.description, position.unit, quote.header.currency)
      }`,
      capabilityId: 'offerten', strength: 1, tags: ['offerten', 'offerten-internal', 'offerten-position'],
      source: 'observation' as const, useCount: 0,
      createdAt: quote.createdAt, updatedAt: at,
      offertenSource: { quoteId: quote.id, positionId: position.id },
      established: quote.updatedAt,
      expires: new Date(Date.parse(quote.updatedAt) + state.memoryRetentionDays * 86_400_000).toISOString(),
    })));
  return [...rules, ...positions.filter((entry) => Date.parse(entry.expires) > now.getTime())];
}

async function publish(
  scope: CompanyScope,
  update: (state: OffertenState) => OffertenState,
  at: string,
): Promise<OffertenState> {
  const before = await readScope(scope);
  const old = fromData(scope, before.offerten);
  await verifyMemory(old);
  const next = update(structuredClone(old));
  const markdown = renderOffertenMemory(next.rules);
  next.memoryHash = hash(markdown);
  next.metrics = metrics(next.observations);
  const path = offertenMemoryPath(scope);
  const previousMarkdown = await optionalRead(path);
  const previousMemory = before.memory.filter(privateMemory);
  const previousEvolution = before.evolution.filter(isOffertenRecord);
  let published = false;
  try {
    await verifiedFileWrite(path, markdown);
    published = true;
    await mutateScope(scope, (data) => ({
      ...data, offerten: [next],
      memory: [...data.memory.filter((entry) => !privateMemory(entry)), ...indexedRules(next, at)],
      evolution: next.observations.length > old.observations.length || next.rules.length > old.rules.length
        ? [...data.evolution, {
          id: idFor('offerten-evolution', [scopeKey(scope), next.observations.length, next.rules.length, at]),
          scope, createdAt: at, updatedAt: at, at,
          kind: next.observations.at(-1)?.decision === 'rejected' ? 'tool-rejected' as const
            : next.observations.at(-1)?.decision === 'approved-edited' ? 'learned' as const : 'reinforced' as const,
          summary: 'Offerten company-local owner decision or approved correction recorded.',
          capabilityId: 'offerten', autonomous: false,
        }]
        : data.evolution,
    }));
    const readback = await readScope(scope);
    if (hash(readback.offerten) !== hash([next]) ||
      hash(readback.memory.filter(privateMemory)) !== hash(indexedRules(next, at))) {
      throw new Error('Offerten publication read-back failed.');
    }
    await verifyMemory(next);
    return next;
  } catch (error) {
    // Restore only this subsystem's records, never overwrite unrelated scope
    // mutations that may have arrived while the disk was being verified.
    if (published) {
      await mutateScope(scope, (data) => ({
        ...data, offerten: before.offerten,
        memory: [...data.memory.filter((entry) => !privateMemory(entry)), ...previousMemory],
        evolution: [...data.evolution.filter((entry) => !isOffertenRecord(entry)), ...previousEvolution],
      }));
    }
    if (previousMarkdown === null) await rm(path, { force: true });
    else await verifiedFileWrite(path, previousMarkdown);
    const restored = await readScope(scope);
    if (hash(restored.offerten) !== hash(before.offerten) ||
      hash(restored.memory.filter(privateMemory)) !== hash(previousMemory) ||
      hash(restored.evolution.filter(isOffertenRecord)) !== hash(previousEvolution) ||
      await optionalRead(path) !== previousMarkdown) {
      throw new Error('Offerten rollback verification failed; no success was recorded.');
    }
    throw error;
  }
}

function audit(state: OffertenState, event: OffertenState['audit'][number]['event'], at: string, quoteId: string | null, detail: string): void {
  state.audit.push({ id: idFor('offerten-audit', [event, at, quoteId, state.audit.length]), at, event, quoteId, detail });
}

function failure(action: string): OffertenOutcome {
  return { ok: false, summary: `Offerten ${action} failed. No success was recorded.`, error: 'offerten-failed' };
}

export async function ingestFromAdapter(ctx: ToolContext, adapter: OffertenAdapter, since: string | null = null): Promise<OffertenOutcome> {
  try {
    const owned = company(ctx.scope);
    if (adapter.kind !== 'fixture') return failure('ingest');
    return await serial(owned, async () => {
      const state = await getOffertenState(owned);
      if (state.connector.type !== 'fixture') throw new Error('Only fixtures are implemented.');
      // These references are checked only inside the executor, one at a time.
      // The fixture needs no authentication and never receives or retains them.
      for (const reference of Object.values(state.connector.secrets)) {
        const plaintext = await ctx.resolveSecrets(reference);
        if (!plaintext || plaintext === reference || plaintext.includes('{{secret:')) {
          throw new Error('A configured vault reference could not be resolved.');
        }
      }
      const ids = await adapter.listQuotesSince(since);
      if (ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error('Invalid fixture quote list.');
      // Fetch and validate the entire batch before making its first mutation.
      const quotes: OffertenQuote[] = [];
      for (const id of ids) {
        const quote = OffertenQuoteSchema.parse(await adapter.fetchQuote(id));
        if (quote.id !== id || !quote.generated) throw new Error('Fixture identity mismatch.');
        if (new Set(quote.positions.map((position) => position.id)).size !== quote.positions.length) throw new Error('Duplicate source position ids.');
        quote.documents = { customer: customerDocument(quote), internal: completeInternalSheet(quote.positions, quote.internal) };
        quote.internal = quote.documents.internal;
        quotes.push(quote);
      }
      const costMasters = z.array(CostMasterSchema).max(1000).parse(
        adapter.fetchCostMasters ? await adapter.fetchCostMasters() : [],
      );
      const at = ctx.now.toISOString();
      const receipt = IngestReceiptSchema.parse({
        id: idFor('offerten-ingest', [scopeKey(owned), at, ctx.callId, ids]),
        generated: true, adapter: 'fixture', quoteIds: ids, quoteCount: quotes.length,
        positionCount: quotes.reduce((sum, quote) => sum + quote.positions.length, 0),
        at, sha256: hash(quotes), verified: true,
      });
      await publish(owned, (current) => {
        current.catalogue = [
          ...current.catalogue.filter((quote) => !ids.includes(quote.id)),
          ...quotes,
        ];
        current.receipts = [...current.receipts.filter((entry) => entry.id !== receipt.id), receipt];
        current.costMasters = costMasters;
        audit(current, 'ingest', at, null, 'Fixture batch imported and read-back verified.');
        return current;
      }, at);
      return { ok: true, summary: 'Generated fixture batch imported and read-back verified. No live ERP was contacted.', affectedIds: [receipt.id], receipt };
    });
  } catch { return failure('ingest'); }
}

export async function ingestFixture(ctx: ToolContext, args: ToolArgs = {}): Promise<OffertenOutcome> {
  if (args.fixture !== undefined && args.fixture !== 'demo') return failure('ingest');
  try {
    const state = await getOffertenState(ctx.scope);
    return await ingestFromAdapter(ctx, fixtureAdapter(state.connector));
  } catch { return failure('ingest'); }
}

export async function draftOfferte(ctx: ToolContext, args: ToolArgs): Promise<OffertenOutcome> {
  try {
    const owned = company(ctx.scope);
    const header = QuoteHeaderSchema.parse({
      customer: typeof args.customer === 'string' ? args.customer : null,
      site: typeof args.site === 'string' && args.site ? args.site : null,
      date: typeof args.date === 'string' ? args.date : ctx.now.toISOString().slice(0, 10),
      currency: args.currency ?? null,
      vatRate: args.vatRate === undefined ? null : Number(args.vatRate),
      language: args.language ?? null, status: 'draft',
    });
    const inputs = z.array(PositionInputSchema).min(1).max(200).parse(JSON.parse(String(args.positions ?? '[]')));
    const at = ctx.now.toISOString();
    return await serial(owned, async () => {
      const state = await getOffertenState(owned);
      const recalled = (await Promise.all(inputs.map((input) => recallMemory({
        scope: owned, text: `${input.description} ${input.unit ?? ''} ${positionRecallKey(input.description, input.unit, header.currency)}`,
        capabilityId: 'offerten', localOnly: true, includeOfferten: true, now: ctx.now, limit: 40,
      })))).flat().map((entry) => entry.record as OffertenIndexRecord)
        .filter((record) => record.expires && Date.parse(record.expires) > ctx.now.getTime());
      const recalledQuotes = new Set(recalled.map((entry) => entry.offertenSource?.quoteId).filter(Boolean));
      const recalledRules = new Set(recalled.map((entry) => entry.offertenSource?.ruleId).filter(Boolean));
      const active = state.rules.filter((rule) => activeRule(rule, ctx.now) && recalledRules.has(rule.id));
      const withCosts = inputs.map((input) => {
        const master = state.costMasters.filter((entry) => entry.effectiveAt <= at)
          .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))
          .find((entry) => entry.description.trim().toLowerCase() === input.description.trim().toLowerCase() &&
            entry.unit === input.unit && entry.currency === header.currency);
        return { ...input, cost: input.cost ?? master?.cost ?? null };
      });
      const priced = pricePositions(withCosts, header, state.catalogue.filter((quote) => recalledQuotes.has(quote.id)), active, ctx.now);
      if (new Set(priced.positions.map((position) => position.id)).size !== priced.positions.length) throw new Error('Duplicate positions.');
      const base = {
        id: idFor('offerte', [scopeKey(owned), ctx.callId, at, args]), revision: 1,
        header, ...priced, generated: true as const, createdAt: at, updatedAt: at, sentRevision: null,
        manualBaselineMinutes: args.manualBaselineMinutes === undefined ? null : Number(args.manualBaselineMinutes),
        intakeMinutes: null,
      };
      const quote = OffertenQuoteSchema.parse({
        ...base, documents: { customer: customerDocument(base), internal: base.internal },
      });
      await publish(owned, (current) => {
        const expired = current.rules.filter((rule) => Date.parse(rule.expires) <= ctx.now.getTime());
        for (const rule of expired) {
          const detail = `Expired rule ${rule.id} excluded from pricing and recall; retained for audit.`;
          if (!current.audit.some((entry) => entry.event === 'expiry' && entry.detail === detail)) audit(current, 'expiry', at, null, detail);
        }
        current.quotes = [...current.quotes.filter((entry) => entry.id !== quote.id), quote];
        audit(current, 'draft', at, quote.id, 'Generated draft saved and documents read-back verified.');
        return current;
      }, at);
      return { ok: true, summary: 'Generated quote drafted locally and read-back verified. Unknown prices need the owner’s number.', affectedIds: [quote.id], quote };
    });
  } catch { return failure('draft'); }
}

export async function compareOfferte(scope: Scope, quoteId: string): Promise<OffertenComparison> {
  const state = await getOffertenState(scope);
  const quote = state.quotes.find((entry) => entry.id === quoteId);
  if (!quote) throw new Error('Quote not found in this company.');
  return comparison(quote, state.catalogue);
}

export async function editOfferte(scope: Scope, quoteId: string, edits: OffertenEdit | unknown, now: Date): Promise<OffertenQuote> {
  const owned = company(scope);
  const parsed = OffertenEditSchema.parse(edits);
  return serial(owned, async () => {
    const state = await getOffertenState(owned);
    const existing = state.quotes.find((quote) => quote.id === quoteId);
    if (!existing) throw new Error('Quote not found in this company.');
    if (existing.revision !== parsed.expectedRevision) throw new Error('Stale quote revision. Reload before editing.');
    if (new Set(parsed.positions.map((entry) => entry.id)).size !== parsed.positions.length ||
      parsed.positions.some((entry) => !existing.positions.some((position) => position.id === entry.id))) {
      throw new Error('Position not found in this quote.');
    }
    const positions = existing.positions.map((position) => {
      const change = parsed.positions.find((entry) => entry.id === position.id);
      if (!change) return position;
      return {
        ...position,
        ...(change.unitPrice !== undefined ? { unitPrice: change.unitPrice } : {}),
        ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
        ...(change.handPrice !== undefined ? { handPrice: change.handPrice } : {}),
        reason: safeReason('owner-edited', { source: { kind: 'owner', id: 'owner-review' } }),
      };
    });
    const sheet = {
      ...existing.internal,
      positions: existing.internal.positions.map((line) => {
        const change = parsed.positions.find((entry) => entry.id === line.positionId);
        return change?.reason ? { ...line, commentary: change.reason.text } : line;
      }),
    };
    const internal = completeInternalSheet(positions, sheet);
    const base = {
      ...existing, positions, internal,
      header: QuoteHeaderSchema.parse({ ...existing.header, ...parsed.header, status: 'draft' }),
      revision: existing.revision + 1, updatedAt: now.toISOString(), sentRevision: null,
      ...(parsed.manualBaselineMinutes !== undefined ? { manualBaselineMinutes: parsed.manualBaselineMinutes } : {}),
    };
    const quote = OffertenQuoteSchema.parse({ ...base, documents: { customer: customerDocument(base), internal } });
    await publish(owned, (current) => {
      current.quotes = current.quotes.map((entry) => entry.id === quoteId ? quote : entry);
      audit(current, 'edit', now.toISOString(), quoteId, 'Owner edit saved; earlier send approvals cannot cover this revision.');
      return current;
    }, now.toISOString());
    return quote;
  });
}

function decisionCall(
  calls: ToolCall[], ctx: ToolContext, quoteId: string, revision: number, status: 'approved' | 'rejected' | 'executed',
): ToolCall | undefined {
  return calls.find((call) =>
    call.id === ctx.callId && scopesEqual(call.scope, ctx.scope) &&
    call.toolId === 'offerten.send' && call.risk === 'external' &&
    call.status === status && call.args.quoteId === quoteId && call.args.revision === revision &&
    Boolean(call.decidedBy) && Boolean(call.decidedAt) && !call.grantId);
}

function observation(quote: OffertenQuote, call: ToolCall, rejected: boolean, at: string): OffertenObservation {
  const positions = quote.positions.map((position) => ({
    positionId: position.id, proposed: position.proposedUnitPrice, final: position.unitPrice,
    deviation: position.proposedUnitPrice === null || position.unitPrice === null ? null : position.unitPrice - position.proposedUnitPrice,
    relativeDeviation: position.proposedUnitPrice === null || position.proposedUnitPrice === 0 || position.unitPrice === null
      ? null : (position.unitPrice - position.proposedUnitPrice) / position.proposedUnitPrice,
    handPrice: position.handPrice,
    handDeviation: position.handPrice === null || position.unitPrice === null ? null : position.unitPrice - position.handPrice,
    handRelativeDeviation: position.handPrice === null || position.handPrice === 0 || position.unitPrice === null
      ? null : (position.unitPrice - position.handPrice) / position.handPrice,
  }));
  const proposed = quote.positions.map((position) => lineTotal(position.quantity, position.proposedUnitPrice));
  const final = quote.documents.customer.subtotal;
  const baseline = proposed.some((value) => value === null) ? null : proposed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const handValues = quote.positions.map((position) => lineTotal(position.quantity, position.handPrice));
  const handTotal = handValues.some((value) => value === null) ? null : handValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return {
    id: idFor('offerten-observation', call.id), quoteId: quote.id, revision: quote.revision, at,
    decision: rejected ? 'rejected' : quote.revision > 1 ? 'approved-edited' : 'approved-as-drafted',
    positions,
    quoteDeviation: baseline === null || final === null ? null : final - baseline,
    quoteRelativeDeviation: baseline === null || baseline === 0 || final === null ? null : (final - baseline) / baseline,
    quoteHandDeviation: handTotal === null || final === null ? null : final - handTotal,
    quoteHandRelativeDeviation: handTotal === null || handTotal === 0 || final === null ? null : (final - handTotal) / handTotal,
    baselineMinutes: quote.manualBaselineMinutes, intakeMinutes: rejected ? null : quote.intakeMinutes,
    currency: quote.header.currency, generated: true,
  };
}

export async function recordApprovedSend(ctx: ToolContext, quoteId: string, revision: number): Promise<OffertenOutcome> {
  try {
    const owned = company(ctx.scope);
    return await serial(owned, async () => {
      const data = await readScope(owned);
      const state = fromData(owned, data.offerten);
      const call = decisionCall(data.toolCalls, ctx, quoteId, revision, 'approved');
      const existing = state.quotes.find((entry) => entry.id === quoteId);
      if (!call || !existing || existing.revision !== revision || state.sends.some((entry) => entry.callId === call.id)) {
        throw new Error('A matching persisted per-call human approval for this exact revision is required.');
      }
      if (existing.positions.some((position) => position.unitPrice === null || position.quantity === null)) {
        throw new Error('Unknown prices and quantities must be resolved by the owner before sending.');
      }
      const at = ctx.now.toISOString();
      const elapsed = (ctx.now.getTime() - Date.parse(existing.createdAt)) / 60_000;
      const base = {
        ...existing, header: { ...existing.header, status: 'sent' as const }, sentRevision: revision, updatedAt: at,
        intakeMinutes: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
      };
      const quote = OffertenQuoteSchema.parse({ ...base, documents: { customer: customerDocument(base), internal: base.internal } });
      const document = quote.documents.customer;
      await publish(owned, (current) => {
        current.quotes = current.quotes.map((entry) => entry.id === quoteId ? quote : entry);
        current.sends.push({
          id: idFor('offerten-send', call.id), quoteId, revision, callId: call.id,
          decidedAt: call.decidedAt!, decidedBy: call.decidedBy!,
          documentHash: hash(document), document, generated: true, at,
        });
        current.observations.push(observation(quote, call, false, at));
        audit(current, 'send-fixture', at, quoteId, 'Approved revision stored as immutable local customer package. Nothing delivered.');
        return current;
      }, at);
      return { ok: true, summary: 'Approved generated revision recorded as a verified local fixture send package. Nothing was delivered externally.', affectedIds: [quoteId], quote };
    });
  } catch { return failure('send'); }
}

export async function recordRejectedOfferte(ctx: ToolContext, quoteId: string, revision: number): Promise<OffertenOutcome> {
  try {
    const owned = company(ctx.scope);
    return await serial(owned, async () => {
      const data = await readScope(owned);
      const call = decisionCall(data.toolCalls, ctx, quoteId, revision, 'rejected');
      const state = fromData(owned, data.offerten);
      const quote = state.quotes.find((entry) => entry.id === quoteId && entry.revision === revision);
      if (!call || !quote) throw new Error('Matching persisted rejection required.');
      const at = ctx.now.toISOString();
      const item = observation(quote, call, true, at);
      await publish(owned, (current) => {
        if (!current.observations.some((entry) => entry.id === item.id)) current.observations.push(item);
        return current;
      }, at);
      return { ok: true, summary: 'Recorded rejection for local decision metrics only. No rejected price was learned.' };
    });
  } catch { return failure('rejection observation'); }
}

export async function updateOffertenMemory(ctx: ToolContext, quoteId: string): Promise<OffertenOutcome> {
  try {
    const owned = company(ctx.scope);
    return await serial(owned, async () => {
      const data = await readScope(owned);
      const state = fromData(owned, data.offerten);
      const quote = state.quotes.find((entry) => entry.id === quoteId);
      const receipt = state.sends.find((entry) => entry.quoteId === quoteId && entry.revision === quote?.revision);
      if (!quote || quote.sentRevision !== quote.revision || !receipt ||
        hash(receipt.document) !== receipt.documentHash || hash(quote.documents.customer) !== receipt.documentHash) {
        throw new Error('Only the read-back approved sent revision can update memory.');
      }
      const call = data.toolCalls.find((entry) => entry.id === receipt.callId);
      if (!call || !decisionCall([call], { ...ctx, callId: receipt.callId }, quoteId, quote.revision, 'executed') ||
        call.decidedAt !== receipt.decidedAt || call.decidedBy !== receipt.decidedBy) {
        throw new Error('Executed human approval required before feedback.');
      }
      const at = ctx.now.toISOString();
      const expires = new Date(ctx.now.getTime() + state.memoryRetentionDays * 86_400_000).toISOString();
      await publish(owned, (current) => {
        for (const rule of current.rules.filter((entry) => !activeRule(entry, ctx.now))) {
          const detail = `Expired rule ${rule.id} excluded from pricing and recall; retained for audit.`;
          if (!current.audit.some((entry) => entry.event === 'expiry' && entry.detail === detail)) audit(current, 'expiry', at, null, detail);
        }
        const generatedRules = quote.positions.filter((position) => position.unitPrice !== null && quote.header.currency !== null).map((position) => OffertenRuleSchema.parse({
          id: idFor('offerten-price', [quote.id, quote.revision, position.id]),
          tag: 'approved-price',
          fact: JSON.stringify({
            description: position.description, proposedUnitPrice: position.proposedUnitPrice,
            ownerUnitPrice: position.unitPrice,
            ownerReason: quote.internal.positions.find((entry) => entry.positionId === position.id)?.commentary ?? '',
          }),
          established: at, expires, source: `${quote.id}@${quote.revision}`,
          pricing: {
            description: position.description, unit: position.unit, currency: quote.header.currency,
            unitPrice: position.unitPrice, customer: quote.header.customer, site: quote.header.site,
          },
        }));
        const ids = new Set(generatedRules.map((entry) => entry.id));
        // An identical feedback run must not extend expiry or duplicate evidence.
        current.rules = [...current.rules.filter((entry) => !ids.has(entry.id)),
          ...generatedRules.map((entry) => current.rules.find((old) => old.id === entry.id) ?? entry)];
        current.catalogue = [...current.catalogue.filter((entry) => entry.id !== quoteId), structuredClone(quote)];
        if (!current.audit.some((entry) => entry.event === 'memory-update' && entry.detail === `${quote.id}@${quote.revision}`)) {
          audit(current, 'memory-update', at, quoteId, `${quote.id}@${quote.revision}`);
        }
        return current;
      }, at);
      return { ok: true, summary: 'Approved read-back quote indexed in company-local Offerten memory. No provider or shared memory was used.', affectedIds: [quoteId] };
    });
  } catch { return failure('memory update'); }
}

export async function replaceOffertenRules(scope: Scope, rules: OffertenRule[], now: Date): Promise<void> {
  const owned = company(scope);
  const parsed = z.array(OffertenRuleSchema).parse(rules);
  if (new Set(parsed.map((rule) => rule.id)).size !== parsed.length) throw new Error('Duplicate rule ids.');
  await serial(owned, () => publish(owned, (state) => ({ ...state, rules: parsed }), now.toISOString()));
}

export async function configureOfferten(scope: Scope, config: ConnectorConfig, now: Date): Promise<void> {
  const owned = company(scope);
  const parsed = ConnectorConfigSchema.parse(config);
  if (parsed.type !== 'fixture') throw new Error('Only the fixture adapter is implemented.');
  await serial(owned, () => publish(owned, (state) => ({ ...state, connector: parsed }), now.toISOString()));
}

export async function exportOfferten(scope: Scope): Promise<OffertenExport> {
  const owned = company(scope);
  return serial(owned, async () => {
    const state = await getOffertenState(owned);
    const memoryMarkdown = await verifyMemory(state);
    const project = (data: ScopeData) => Object.fromEntries(
      COLLECTION_NAMES.filter((name) => name !== 'offerten')
        .map((name) => [name, data[name].filter(isOffertenRecord)]),
    );
    const snapshot = await readScope(owned);
    const records = project(snapshot);
    const readback = await readScope(owned);
    if (hash(snapshot.offerten) !== hash(readback.offerten) || hash(records) !== hash(project(readback))) {
      throw new Error('Offerten export snapshot changed before read-back verification.');
    }
    const bundle = { generated: true as const, state, memoryMarkdown, records };
    return { ...bundle, sha256: hash(bundle) };
  });
}

export async function deleteOfferten(scope: Scope): Promise<ToolOutcome> {
  try {
    const owned = company(scope);
    return await serial(owned, async () => {
      const scrubbedCallIds = new Set<string>();
      await mutateScope(owned, (data) => {
        const cleaned = { ...data, offerten: [] };
        for (const name of COLLECTION_NAMES) {
          if (name === 'offerten' || name === 'toolCalls') continue;
          (cleaned[name] as unknown[]) = data[name].filter((entry) => !isOffertenRecord(entry));
        }
        cleaned.toolCalls = data.toolCalls.map((call) => {
          if (!isOffertenRecord(call)) return call;
          scrubbedCallIds.add(call.id);
          return {
            ...call, args: {}, preview: 'Offerten data deleted.', result: 'Offerten data deleted.',
            affectedIds: [], error: undefined,
          };
        });
        return cleaned;
      });
      await rm(join(offertenMemoryPath(owned), '..', '..'), { recursive: true, force: true });
      const readback = await readScope(owned);
      if (readback.offerten.length ||
        COLLECTION_NAMES.some((name) => name !== 'offerten' && name !== 'toolCalls' && readback[name].some(isOffertenRecord)) ||
        [...scrubbedCallIds].some((id) => {
          const call = readback.toolCalls.find((entry) => entry.id === id);
          return !call || Object.keys(call.args).length > 0 || call.affectedIds.length > 0 ||
            call.preview !== 'Offerten data deleted.' || call.result !== 'Offerten data deleted.' || call.error !== undefined;
        }) ||
        await optionalRead(offertenMemoryPath(owned)) !== null) {
        throw new Error('Deletion could not be verified.');
      }
      return { ok: true, summary: 'Company-local Offerten catalogue, documents, packages, rules, index and tool payloads deleted and absence verified.' };
    });
  } catch { return failure('deletion'); }
}
