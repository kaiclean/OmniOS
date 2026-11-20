import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { companyScope, personalScope, sharedScope } from '@/lib/domain';
import type { Scope, ToolCall, ToolContext } from '@/lib/domain';
import * as store from '@/lib/data/store';
import { resetDataDirForTests } from '@/lib/data/data-dir';
import {
  ConnectorConfigSchema, OffertenRuleSchema, PositionInputSchema, QuoteHeaderSchema,
} from '@/lib/offerten/schema';
import type { OffertenQuote, OffertenRule } from '@/lib/offerten/schema';
import { fixtureAdapter } from '@/lib/offerten/adapter';
import {
  compareOfferte, configureOfferten, deleteOfferten, draftOfferte, editOfferte, exportOfferten,
  getOffertenState, ingestFixture, ingestFromAdapter, offertenMemoryPath,
  recordApprovedSend, recordRejectedOfferte, replaceOffertenRules, updateOffertenMemory,
} from '@/lib/offerten/service';
import { pricePositions } from '@/lib/offerten/pricing';

const NOW = new Date('2026-11-20T04:00:00.000Z');
let directory: string;
let sequence = 0;
const freshScope = () => companyScope(`offerten-core-${++sequence}`);
const context = (scope: Scope, callId = `call-${++sequence}`): ToolContext => ({
  scope, now: NOW, actor: 'founder', callId,
  resolveSecrets: async () => { throw new Error('Fixture must not resolve secrets.'); },
});
const draftArgs = (positions: unknown[] = [{ description: 'Maintenance cleaning', quantity: 2, unit: 'hour', handPrice: 6400 }]) => ({
  customer: 'Fixture Customer', site: 'Zurich', date: '2026-11-20',
  currency: 'CHF', language: 'de', vatRate: 8.1, positions: JSON.stringify(positions),
});

async function draft(scope: Scope, positions?: unknown[]): Promise<OffertenQuote> {
  const outcome = await draftOfferte(context(scope), draftArgs(positions));
  expect(outcome.ok).toBe(true);
  expect(outcome.quote).toBeDefined();
  return outcome.quote!;
}

async function decision(scope: Scope, quote: OffertenQuote, status: 'approved' | 'rejected' = 'approved'): Promise<ToolContext> {
  const ctx = context(scope);
  const call: ToolCall = {
    id: ctx.callId!, scope, toolId: 'offerten.send', args: { quoteId: quote.id, revision: quote.revision },
    status, risk: 'external', preview: 'Local generated package only.', affectedIds: [],
    at: NOW.toISOString(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    decidedAt: NOW.toISOString(), decidedBy: 'founder',
  };
  await store.insertRecords(scope, 'toolCalls', [call]);
  return ctx;
}

async function sent(scope: Scope, quote: OffertenQuote): Promise<ToolContext> {
  const ctx = await decision(scope, quote);
  expect((await recordApprovedSend(ctx, quote.id, quote.revision)).ok).toBe(true);
  await store.updateRecord(scope, 'toolCalls', ctx.callId!, { status: 'executed' });
  return ctx;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'omnios-offerten-core-'));
  process.env.OMNIOS_DATA_DIR = directory;
  resetDataDirForTests();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
  resetDataDirForTests();
});

describe('Offerten boundaries and fixture ingestion', () => {
  it('validates connector placeholder-only secrets and nullable source fields', () => {
    expect(ConnectorConfigSchema.safeParse({ host: 'erp.local', type: 'postgres', mapping: {}, secrets: { password: '{{secret:ERP_PASSWORD}}' } }).success).toBe(true);
    expect(ConnectorConfigSchema.safeParse({ host: 'erp.local', type: 'postgres', secrets: { password: 'plaintext-password' } }).success).toBe(false);
    expect(ConnectorConfigSchema.safeParse({ host: '******erp.local' }).success).toBe(false);
    expect(QuoteHeaderSchema.parse({}).currency).toBeNull();
    expect(QuoteHeaderSchema.parse({}).date).toBeNull();
    expect(PositionInputSchema.safeParse({ description: 'x', unitPrice: 1.5 }).success).toBe(false);
    expect(OffertenRuleSchema.safeParse({ id: 'x', tag: 'x', fact: 'x', established: NOW.toISOString(), expires: null, source: 'owner' }).success).toBe(false);
  });

  it('is company-only and hashes hostile company ids into a safe directory', async () => {
    await expect(getOffertenState(personalScope())).rejects.toThrow('company');
    await expect(exportOfferten(sharedScope('offerten'))).rejects.toThrow('company');
    expect((await ingestFixture(context(personalScope()))).ok).toBe(false);
    const path = offertenMemoryPath(companyScope('../../outside'));
    expect(path.startsWith(directory)).toBe(true);
    expect(path).not.toContain('outside');
  });

  it('imports a complete verified fixture batch into one company only', async () => {
    const a = freshScope();
    const b = freshScope();
    const result = await ingestFixture(context(a));
    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({ generated: true, quoteCount: 2, positionCount: 3, verified: true });
    const state = await getOffertenState(a);
    expect(state.catalogue).toHaveLength(2);
    expect(state.costMasters).toHaveLength(1);
    expect(state.catalogue.every((quote) => quote.generated)).toBe(true);
    expect((await getOffertenState(b)).catalogue).toEqual([]);
    expect(state.metrics.observationCount).toBeNull();
  });

  it('does not partially import when fetching any quote fails', async () => {
    const scope = freshScope();
    const adapter = fixtureAdapter();
    const ids = await adapter.listQuotesSince(null);
    const outcome = await ingestFromAdapter(context(scope), {
      ...adapter,
      async fetchQuote(id) {
        if (id === ids[1]) throw new Error('fixture second-fetch failure');
        return adapter.fetchQuote(id);
      },
    });
    expect(outcome.ok).toBe(false);
    expect((await getOffertenState(scope)).catalogue).toEqual([]);
    expect((await getOffertenState(scope)).receipts).toEqual([]);
  });

  it('rejects duplicate source position ids or invalid internal-sheet links atomically', async () => {
    const adapter = fixtureAdapter();
    const id = (await adapter.listQuotesSince(null))[0]!;
    const original = await adapter.fetchQuote(id) as OffertenQuote;
    for (const invalid of [
      { ...original, positions: [original.positions[0], original.positions[0]] },
      { ...original, internal: { ...original.internal, positions: [{ ...original.internal.positions[0]!, positionId: 'not-in-quote' }] } },
    ]) {
      const scope = freshScope();
      const outcome = await ingestFromAdapter(context(scope), {
        kind: 'fixture', async listQuotesSince() { return [id]; }, async fetchQuote() { return invalid; },
      });
      expect(outcome.ok).toBe(false);
      expect((await store.readScope(scope)).offerten).toEqual([]);
    }
  });

  it('retains every source header/status and receipt count, but never indexes rejected prices', async () => {
    const scope = freshScope();
    const adapter = fixtureAdapter();
    const id = (await adapter.listQuotesSince(null))[0]!;
    const source = await adapter.fetchQuote(id) as OffertenQuote;
    const rejected = { ...source, header: { ...source.header, status: 'rejected' } };
    const result = await ingestFromAdapter(context(scope), {
      kind: 'fixture', async listQuotesSince() { return [id]; },
      async fetchQuote() { return rejected; },
    });
    expect(result.receipt).toMatchObject({ quoteCount: 1, positionCount: 2 });
    expect((await getOffertenState(scope)).catalogue[0]?.header).toEqual(rejected.header);
    expect((await store.readCollection(scope, 'memory')).filter((entry) => entry.capabilityId === 'offerten')).toEqual([]);
    expect((await draft(scope)).positions[0]?.unitPrice).toBeNull();
  });

  it('rolls back data and memory after a post-write failure', async () => {
    const scope = freshScope();
    const mutate = store.mutateScope;
    const spy = vi.spyOn(store, 'mutateScope').mockImplementationOnce(async (...args) => {
      await mutate(...args);
      throw new Error('injected read-back failure after persistence');
    });
    const outcome = await ingestFixture(context(scope));
    spy.mockRestore();
    expect(outcome.ok).toBe(false);
    expect((await getOffertenState(scope)).catalogue).toEqual([]);
    expect((await store.readScope(scope)).offerten).toEqual([]);
    await expect(readFile(offertenMemoryPath(scope), 'utf8')).rejects.toThrow();
  });

  it('rejects live connectors; validates configured vault refs only in the executor without retaining plaintext', async () => {
    const scope = freshScope();
    await expect(configureOfferten(scope, ConnectorConfigSchema.parse({ type: 'postgres', host: 'erp.local' }), NOW)).rejects.toThrow('fixture');
    await configureOfferten(scope, ConnectorConfigSchema.parse({ secrets: { password: '{{secret:ERP_PASSWORD}}' } }), NOW);
    const resolveSecrets = vi.fn(async () => 'fixture-vault-canary-do-not-persist');
    const outcome = await ingestFixture({ ...context(scope), resolveSecrets });
    expect(outcome.ok).toBe(true);
    expect(resolveSecrets).toHaveBeenCalledExactlyOnceWith('{{secret:ERP_PASSWORD}}');
    expect(JSON.stringify(await exportOfferten(scope))).not.toContain('fixture-vault-canary');
    expect(JSON.stringify(outcome)).not.toContain('fixture-vault-canary');
    const before = await exportOfferten(scope);
    const missing = await ingestFixture({ ...context(scope), resolveSecrets: async (value) => value });
    expect(missing.ok).toBe(false);
    expect((await exportOfferten(scope)).sha256).toBe(before.sha256);
  });
});

describe('evidence-priority pricing and safe documents', () => {
  it('prefers exact scoped past positions over explicit rules and costs', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const rule: OffertenRule = {
      id: 'rule1', tag: 'price', fact: 'PRIVATE margin strategy must not leak',
      established: '2026-01-01T00:00:00.000Z', expires: '2027-01-01T00:00:00.000Z', source: 'owner',
      pricing: { description: 'Maintenance cleaning', unit: 'hour', currency: 'CHF', unitPrice: 9999, customer: null, site: null },
    };
    await replaceOffertenRules(scope, [rule], NOW);
    const quote = await draft(scope, [
      { description: 'Maintenance cleaning', quantity: 2, unit: 'hour', cost: 4000, handPrice: 6400 },
      { description: 'Rule service', quantity: 1, unit: 'job', cost: 3000 },
    ]);
    expect(quote.positions[0]).toMatchObject({ unitPrice: 6500, reason: { code: 'past-position' } });
    expect(quote.internal.positions[0]).toMatchObject({ cost: 4000, margin: 2500, lineCost: 8000, lineRevenue: 13000, lineMargin: 5000 });
    expect(quote.documents.customer.positions[0]?.reason.source?.kind).toBe('position');
    expect(JSON.stringify(quote.documents.customer)).not.toMatch(/PRIVATE|margin|commentary|handPrice|sourceQuoteId|"cost"/);
  });

  it('uses the scoped recall index as evidence, not an unindexed raw catalogue scan', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const indexed = await store.readCollection(scope, 'memory');
    expect(indexed.some((entry) => entry.tags.includes('offerten-position'))).toBe(true);
    await store.mutateScope(scope, (data) => ({ ...data, memory: data.memory.filter((entry) => entry.capabilityId !== 'offerten') }));
    expect((await getOffertenState(scope)).catalogue).toHaveLength(2);
    const quote = await draft(scope);
    expect(quote.positions[0]?.unitPrice).toBeNull();
  });

  it('recalls exact short descriptions and Unicode units through stable local retrieval keys', async () => {
    const scope = freshScope();
    const adapter = fixtureAdapter();
    const id = (await adapter.listQuotesSince(null))[0]!;
    const original = await adapter.fetchQuote(id) as OffertenQuote;
    const source = {
      ...original,
      positions: original.positions.map((position, index) => index === 0
        ? { ...position, description: 'WC', unit: 'm²', unitPrice: 1200 } : position),
    };
    expect((await ingestFromAdapter(context(scope), {
      kind: 'fixture', async listQuotesSince() { return [id]; }, async fetchQuote() { return source; },
    })).ok).toBe(true);
    const quote = await draft(scope, [{ description: ' WC ', quantity: 3, unit: 'm²' }]);
    expect(quote.positions[0]).toMatchObject({ unitPrice: 1200, reason: { code: 'past-position' } });
  });

  it('uses explicit rules then current cost masters then owner unknowns', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    await replaceOffertenRules(scope, [{
      id: 'rule', tag: 'price', fact: 'PRIVATE', established: '2026-01-01T00:00:00.000Z',
      expires: '2027-01-01T00:00:00.000Z', source: 'owner',
      pricing: { description: 'New service', unit: 'job', currency: 'CHF', unitPrice: 5000, customer: null, site: null },
    }], NOW);
    const quote = await draft(scope, [
      { description: 'New service', quantity: 2, unit: 'job', cost: 3000 },
      { description: 'Special cleaning', quantity: 2, unit: 'hour' },
      { description: 'Unknown', quantity: null, unit: null },
    ]);
    expect(quote.positions.map((position) => position.unitPrice)).toEqual([5000, 6000, null]);
    expect(quote.positions.map((position) => position.reason.code)).toEqual(['explicit-rule', 'cost', 'owner-number']);
    expect(quote.documents.customer.subtotal).toBeNull();
    expect(quote.documents.customer.total).toBeNull();
    expect(quote.internal.totalCost).toBeNull();
    expect(quote.internal.totalMargin).toBeNull();
    expect(quote.positions[1]?.reason.nearestComparableDelta).not.toBeNull();
  });

  it('will not match missing dimensions, unknown currencies, or rejected historical prices', async () => {
    const header = QuoteHeaderSchema.parse({ customer: 'x', currency: 'CHF' });
    const inputs = [PositionInputSchema.parse({ description: 'Maintenance cleaning', quantity: 1, unit: null })];
    const adapter = fixtureAdapter();
    const quotes = await Promise.all((await adapter.listQuotesSince(null)).map(async (id) => await adapter.fetchQuote(id) as OffertenQuote));
    expect(pricePositions(inputs, header, quotes, [], NOW).positions[0]?.unitPrice).toBeNull();
    const priced = [PositionInputSchema.parse({ description: 'Maintenance cleaning', quantity: 1, unit: 'hour' })];
    expect(pricePositions(priced, { ...header, currency: null }, quotes, [], NOW).positions[0]?.unitPrice).toBeNull();
    const rejected = quotes.map((quote) => ({ ...quote, header: { ...quote.header, status: 'rejected' as const } }));
    expect(pricePositions(priced, header, rejected, [], NOW).positions[0]?.unitPrice).toBeNull();
  });

  it('expires rules, audits removal, and read-back detects memory corruption', async () => {
    const scope = freshScope();
    await replaceOffertenRules(scope, [{
      id: 'expired', tag: 'price', fact: 'expired confidential strategy',
      established: '2026-01-01T00:00:00.000Z', expires: NOW.toISOString(), source: 'owner',
      pricing: { description: 'Expired service', unit: 'hour', currency: 'CHF', unitPrice: 9999, customer: null, site: null },
    }], NOW);
    const quote = await draft(scope, [{ description: 'Expired service', quantity: 1, unit: 'hour' }]);
    expect(quote.positions[0]?.unitPrice).toBeNull();
    const state = await getOffertenState(scope);
    expect(state.rules).toHaveLength(1);
    expect(state.rules[0]?.id).toBe('expired');
    expect(state.audit.some((entry) => entry.event === 'expiry')).toBe(true);
    expect((await store.readCollection(scope, 'memory')).filter((entry) => entry.capabilityId === 'offerten')).toEqual([]);
    await writeFile(offertenMemoryPath(scope), 'corrupt', 'utf8');
    await expect(exportOfferten(scope)).rejects.toThrow('read-back');
  });

  it('validates stale edits, keeps owner text internal, and compares hand calculations', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const quote = await draft(scope);
    const edited = await editOfferte(scope, quote.id, {
      expectedRevision: quote.revision,
      positions: [{ id: quote.positions[0]!.id, unitPrice: 7000, handPrice: 6800, reason: { code: 'owner-edited', text: 'PRIVATE cost/margin rationale' } }],
    }, NOW);
    expect(edited.revision).toBe(2);
    expect(JSON.stringify(edited.documents.customer)).not.toContain('PRIVATE');
    expect(edited.internal.positions[0]?.commentary).toContain('PRIVATE');
    await expect(editOfferte(scope, quote.id, { expectedRevision: 1, positions: [] }, NOW)).rejects.toThrow('Stale');
    const compare = await compareOfferte(scope, quote.id);
    expect(compare.positions[0]?.delta).toBe(200);
    expect(compare.totalDelta).toBe(400);
    expect(compare.positions[0]?.nearestComparables.length).toBeGreaterThan(0);
    await expect(compareOfferte(freshScope(), quote.id)).rejects.toThrow('not found');
  });
});

describe('revision approvals, feedback, export and deletion', () => {
  it('requires a persisted matching exact revision approval and preserves immutable customer packages', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const quote = await draft(scope);
    expect((await recordApprovedSend(context(scope), quote.id, quote.revision)).ok).toBe(false);
    const ctx = await decision(scope, quote);
    const revised = await editOfferte(scope, quote.id, { expectedRevision: 1, positions: [{ id: quote.positions[0]!.id, unitPrice: 7000 }] }, NOW);
    expect((await recordApprovedSend(ctx, quote.id, quote.revision)).ok).toBe(false);
    await sent(scope, revised);
    const packageBefore = (await getOffertenState(scope)).sends[0]!;
    expect(packageBefore.document.positions[0]?.unitPrice).toBe(7000);
    await editOfferte(scope, quote.id, { expectedRevision: 2, positions: [{ id: quote.positions[0]!.id, unitPrice: 9000 }] }, NOW);
    const packageAfter = (await getOffertenState(scope)).sends[0]!;
    expect(packageAfter.documentHash).toBe(packageBefore.documentHash);
    expect(packageAfter.document.positions[0]?.unitPrice).toBe(7000);
    expect(JSON.stringify(packageAfter.document)).not.toMatch(/"cost"|commentary|margin|handPrice/);
  });

  it('learns only an executed approved read-back revision and is idempotent', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const quote = await draft(scope);
    expect((await updateOffertenMemory(context(scope), quote.id)).ok).toBe(false);
    const ctx = await decision(scope, quote);
    expect((await recordApprovedSend(ctx, quote.id, quote.revision)).ok).toBe(true);
    expect((await updateOffertenMemory(ctx, quote.id)).ok).toBe(false);
    await store.updateRecord(scope, 'toolCalls', ctx.callId!, { status: 'executed' });
    expect((await updateOffertenMemory(ctx, quote.id)).ok).toBe(true);
    const state = await getOffertenState(scope);
    expect(state.rules).toHaveLength(1);
    expect(state.rules[0]?.source).toBe(`${quote.id}@${quote.revision}`);
    expect(Date.parse(state.rules[0]!.expires)).toBeGreaterThan(NOW.getTime());
    const md = await readFile(offertenMemoryPath(scope), 'utf8');
    expect(md).toContain('| id | tag | fact | established | expires | source |');
    expect((await updateOffertenMemory(ctx, quote.id)).ok).toBe(true);
    expect((await getOffertenState(scope)).rules).toHaveLength(1);
    const revised = await editOfferte(scope, quote.id, { expectedRevision: 1, positions: [] }, NOW);
    expect(revised.sentRevision).toBeNull();
    expect((await updateOffertenMemory(ctx, quote.id)).ok).toBe(false);
  });

  it('records owner corrections and reasons in expiring private memory plus the evolution log', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const proposed = await draft(scope);
    const edited = await editOfferte(scope, proposed.id, {
      expectedRevision: 1,
      positions: [{ id: proposed.positions[0]!.id, unitPrice: 7100, reason: { code: 'owner-edited', text: 'PRIVATE approved exception' } }],
    }, NOW);
    const ctx = await sent(scope, edited);
    expect((await updateOffertenMemory(ctx, edited.id)).ok).toBe(true);
    const state = await getOffertenState(scope);
    expect(state.rules[0]?.fact).toContain('"proposedUnitPrice":6500');
    expect(state.rules[0]?.fact).toContain('"ownerUnitPrice":7100');
    expect(state.rules[0]?.fact).toContain('PRIVATE approved exception');
    expect((await store.readCollection(scope, 'evolution')).some((entry) => entry.capabilityId === 'offerten' && entry.kind === 'learned')).toBe(true);
    const bundle = await exportOfferten(scope);
    expect(bundle.records.memory?.length).toBeGreaterThan(0);
    expect(bundle.records.evolution?.length).toBeGreaterThan(0);
    expect(JSON.stringify(state.sends[0]?.document)).not.toContain('PRIVATE');
  });

  it('keeps hand comparisons separate from corrections and measures intake to approval, never client-supplied duration', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const outcome = await draftOfferte(context(scope), {
      ...draftArgs(), manualBaselineMinutes: 45, intakeMinutes: 9999,
    });
    const proposed = outcome.quote!;
    const edited = await editOfferte(scope, proposed.id, {
      expectedRevision: 1, positions: [{ id: proposed.positions[0]!.id, unitPrice: 7000 }],
    }, NOW);
    const approval = await decision(scope, edited);
    expect((await recordApprovedSend({ ...approval, now: new Date(NOW.getTime() + 7 * 60_000) }, edited.id, edited.revision)).ok).toBe(true);
    const state = await getOffertenState(scope);
    expect(state.observations[0]?.positions[0]).toMatchObject({
      proposed: 6500, final: 7000, handPrice: 6400, deviation: 500, handDeviation: 600,
    });
    expect(state.observations[0]?.quoteDeviation).toBe(1000);
    expect(state.observations[0]?.quoteHandDeviation).toBe(1200);
    expect(state.metrics.priceDeviation).toBe(1200);
    expect(state.metrics.relativePriceDeviation).toBeCloseTo(600 / 6400);
    expect(state.metrics.timeSavedMinutes).toBe(38);
    expect(state.metrics.acceptanceRate).toBeNull();
  });

  it('keeps hand deviation distribution null until three independent finite comparisons', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    const quote = await draft(scope, [
      { description: 'Maintenance cleaning', quantity: 1, unit: 'hour', handPrice: 6500 },
      { description: 'Window cleaning', quantity: 1, unit: 'm²', handPrice: 1000 },
      { description: 'Deep cleaning', quantity: 1, unit: 'hour', handPrice: 10000 },
    ]);
    expect((await getOffertenState(scope)).metrics.handDeviationDistribution).toBeNull();
    await sent(scope, quote);
    const state = await getOffertenState(scope);
    expect(state.metrics.handComparisonCount).toBe(3);
    expect(state.metrics.handDeviationDistribution).toEqual({ n: 3, median: 0.15, p90: 0.21 });
  });

  it('does not average monetary hand deviations across currencies', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    await sent(scope, await draft(scope));
    const outcome = await draftOfferte(context(scope), {
      ...draftArgs([{ description: 'Euro service', quantity: 1, unit: 'hour', cost: 8000, handPrice: 7000 }]),
      currency: 'EUR',
    });
    expect(outcome.ok).toBe(true);
    await sent(scope, outcome.quote!);
    const state = await getOffertenState(scope);
    expect(state.metrics.priceDeviation).toBeNull();
    expect(state.metrics.relativePriceDeviation).not.toBeNull();
  });

  it('records scoped decision observations without learning rejected prices; rates need three observations', async () => {
    const scope = freshScope();
    await ingestFixture(context(scope));
    expect((await getOffertenState(scope)).metrics.acceptanceRate).toBeNull();
    const quote1 = await draft(scope);
    await sent(scope, quote1);
    expect((await getOffertenState(scope)).metrics.acceptanceRate).toBeNull();
    const quote2 = await draft(scope);
    const edited = await editOfferte(scope, quote2.id, { expectedRevision: 1, positions: [{ id: quote2.positions[0]!.id, unitPrice: 6600 }] }, NOW);
    await sent(scope, edited);
    const quote3 = await draft(scope);
    const rejected = await decision(scope, quote3, 'rejected');
    expect((await recordRejectedOfferte(rejected, quote3.id, 1)).ok).toBe(true);
    expect((await updateOffertenMemory(rejected, quote3.id)).ok).toBe(false);
    const state = await getOffertenState(scope);
    expect(state.metrics).toMatchObject({ observationCount: 3, approvedAsDrafted: 1, approvedEdited: 1, rejected: 1, timeSavedMinutes: null });
    expect(state.metrics.acceptanceRate).toBeCloseTo(2 / 3);
    expect(Number.isInteger(state.metrics.priceDeviation)).toBe(true);
    expect(state.observations[1]?.positions[0]?.deviation).toBe(100);
    expect(state.catalogue.some((entry) => entry.id === quote3.id)).toBe(false);
    expect((await getOffertenState(freshScope())).observations).toEqual([]);
  });

  it('exports verified private data locally and deletes derived files, index, packages and tool payloads only in scope', async () => {
    const a = freshScope();
    const b = freshScope();
    await ingestFixture(context(a));
    await ingestFixture(context(b));
    const quote = await draft(a);
    const ctx = await sent(a, quote);
    await updateOffertenMemory(ctx, quote.id);
    const bundle = await exportOfferten(a);
    expect(bundle.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.state.sends).toHaveLength(1);
    expect(bundle.memoryMarkdown).toContain(quote.id);
    const erased = await deleteOfferten(a);
    expect(erased.ok).toBe(true);
    expect((await getOffertenState(a)).quotes).toEqual([]);
    expect((await store.readCollection(a, 'toolCalls')).every((call) =>
      Object.keys(call.args).length === 0 && call.affectedIds.length === 0 &&
      call.preview === 'Offerten data deleted.' && call.result === 'Offerten data deleted.' && call.error === undefined)).toBe(true);
    await expect(readFile(offertenMemoryPath(a), 'utf8')).rejects.toThrow();
    expect((await getOffertenState(b)).catalogue).toHaveLength(2);
  });
});
