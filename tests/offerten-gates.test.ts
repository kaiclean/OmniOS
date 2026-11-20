import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmProvider, LlmRequest, MemoryRecord, ToolArgs, ToolContext } from '@/lib/domain';
import { companyScope, personalScope, promotionCheck, sharedScope } from '@/lib/domain';
import { emptyScopeData } from '@/lib/data/schema';
import { OFFERTEN_TOOLS } from '@/lib/ai/tools/offerten-registry';
import { derivePageContext } from '@/lib/ui/page-context';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  plan: vi.fn(),
  embed: vi.fn(),
}));
vi.mock('@/lib/ai/providers', async (original) => ({
  ...await original<typeof import('@/lib/ai/providers')>(),
  activeProvider: async () => ({
    id: 'capture', label: 'Capture provider', simulated: false, keyName: null,
    available: async () => true,
    complete: mocks.complete,
    completeWithTools: mocks.plan,
  }),
}));
vi.mock('@/lib/ai/embeddings', async (original) => ({
  ...await original<typeof import('@/lib/ai/embeddings')>(),
  embedTexts: mocks.embed,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const NOW = new Date('2026-11-20T04:00:00.000Z');
const scope = companyScope('offerten-gates');
let directory: string;
const CANARY = 'PRIVATE_COST_RULE_CANARY';
const args: ToolArgs = {
  customer: 'Private Customer GmbH',
  site: 'Private Site Address',
  date: '2026-11-20',
  currency: 'CHF',
  vatRate: 8.1,
  language: 'de',
  positions: JSON.stringify([{ description: 'Owner review work', quantity: 2, unit: 'h', cost: 1200, handPrice: 1700 }]),
};

let store: typeof import('@/lib/data/store');
let tools: typeof import('@/lib/ai/tools/executors');
let propose: typeof import('@/lib/ai/tools/propose');
let decide: typeof import('@/lib/approvals/decide');
let offerten: typeof import('@/lib/offerten/service');
let recall: typeof import('@/lib/ai/recall');
let assistant: typeof import('@/lib/ai/assistant');
let mcp: typeof import('@/lib/mcp/serve');
let promotion: typeof import('@/lib/actions/memory');

const context = (): ToolContext => ({
  scope, now: NOW, actor: 'founder', resolveSecrets: async (value) => value,
});

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'omnios-offerten-gates-'));
  process.env.OMNIOS_DATA_DIR = directory;
  [store, tools, propose, decide, offerten, recall, assistant, mcp, promotion] = await Promise.all([
    import('@/lib/data/store'),
    import('@/lib/ai/tools/executors'),
    import('@/lib/ai/tools/propose'),
    import('@/lib/approvals/decide'),
    import('@/lib/offerten/service'),
    import('@/lib/ai/recall'),
    import('@/lib/ai/assistant'),
    import('@/lib/mcp/serve'),
    import('@/lib/actions/memory'),
  ]);
  await store.getWorkspace();
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.complete.mockResolvedValue({ text: 'Grounded public reply.', providerId: 'capture', simulated: false });
  mocks.plan.mockResolvedValue({ text: '', calls: [], providerId: 'capture', simulated: false });
  mocks.embed.mockResolvedValue({ vectors: [[1, 0]], model: 'capture', dimensions: 2 });
  await rm(join(directory, 'offerten'), { recursive: true, force: true });
  await store.writeScopeData(scope, emptyScopeData());
  await store.writeScopeData(sharedScope('offerten'), emptyScopeData());
  await store.saveWorkspace((root) => ({
    ...root, grants: [], settings: { ...root.settings, confirmWrites: false },
  }));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

async function draft() {
  const result = await tools.runTool('offerten.draft', context(), args);
  expect(result.ok, result.error).toBe(true);
  const quote = (await offerten.getOffertenState(scope)).quotes[0];
  if (!quote) throw new Error('Expected the persisted draft.');
  return quote;
}

function memory(id: string, patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id, scope, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    kind: 'lesson', text: `canary ${CANARY}`, capabilityId: 'offerten',
    strength: 1, tags: ['offerten-internal'], source: 'founder', useCount: 0,
    embedding: [1, 0], ...patch,
  };
}

async function privateMemories() {
  await store.insertRecords(scope, 'memory', [
    memory('private-capability', { tags: [] }),
    memory('private-tag', { capabilityId: 'operations' }),
    memory('public-memory', { capabilityId: 'operations', tags: [], text: 'canary public operational lesson' }),
  ]);
}

describe('Offerten uses the existing gate without exceptions', () => {
  it('declares accurate tiers, company-only scope and safe incomplete previews', async () => {
    expect(Object.fromEntries(OFFERTEN_TOOLS.map((tool) => [tool.id, tool.risk]))).toEqual({
      'offerten.ingest': 'external', 'offerten.draft': 'write', 'offerten.compare': 'read',
      'offerten.edit': 'write', 'offerten.send': 'external', 'offerten.update_memory': 'write',
      'offerten.export': 'write', 'offerten.delete': 'destructive',
    });
    for (const tool of OFFERTEN_TOOLS) {
      expect(tool.scopeKinds).toEqual(['company']);
      expect(tool.preview({})).toBeTruthy();
      expect(tool.preview({ ...args, fixture: CANARY, edits: CANARY, apiKey: CANARY })).not.toContain(CANARY);
    }
    const result = await tools.runTool('offerten.draft', { ...context(), scope: personalScope() }, args);
    expect(result.ok).toBe(false);
    const draftTool = OFFERTEN_TOOLS.find((tool) => tool.id === 'offerten.draft');
    expect(draftTool?.params.some((param) => param.name === 'manualBaselineMinutes')).toBe(true);
    expect(draftTool?.params.some((param) => (param.name as string) === 'intakeMinutes')).toBe(false);
  });

  it('queues ingest, send and deletion without mutating private state', async () => {
    for (const [toolId, toolArgs] of [
      ['offerten.ingest', {}], ['offerten.send', { quoteId: 'quote_123', revision: 1 }],
      ['offerten.delete', {}],
    ] as const) {
      expect((await propose.proposeCore(scope, toolId, toolArgs, { now: NOW })).awaitingApproval).toBe(true);
    }
    const state = await offerten.getOffertenState(scope);
    expect(state.catalogue).toHaveLength(0);
    expect(state.sends).toHaveLength(0);
  });

  it('refuses fabricated approval options without a matching persisted call', async () => {
    const quote = await draft();
    const options = { approval: { decidedBy: 'founder', decidedAt: NOW.toISOString() } };
    const result = await tools.runTool('offerten.send', { ...context(), callId: 'invented' }, {
      quoteId: quote.id, revision: quote.revision,
    }, options);
    expect(result.ok).toBe(false);
    expect((await offerten.getOffertenState(scope)).sends).toHaveLength(0);
  });

  it('cannot cover the built-in send with an MCP wildcard grant', async () => {
    await store.saveWorkspace((root) => ({
      ...root, grants: [{
        id: 'grant_offerten', serverId: 'offerten', toolName: '*', scopeKey: '*',
        note: 'Cannot authorise a built-in', createdAt: NOW.toISOString(),
      }],
    }));
    const result = await propose.proposeCore(scope, 'offerten.send', { quoteId: 'quote_123', revision: 1 }, { now: NOW });
    expect(result.awaitingApproval).toBe(true);
    const call = (await store.readCollection(scope, 'toolCalls')).find((entry) => entry.id === result.toolCallId);
    expect(call?.grantId).toBeUndefined();
  });

  it('honours confirmWrites for drafts', async () => {
    await store.saveWorkspace((root) => ({ ...root, settings: { ...root.settings, confirmWrites: true } }));
    const result = await propose.proposeCore(scope, 'offerten.draft', args, { now: NOW });
    expect(result.awaitingApproval).toBe(true);
    expect((await offerten.getOffertenState(scope)).quotes).toHaveLength(0);
    expect((await decide.approveToolCallAs(scope, result.toolCallId, 'founder')).ok).toBe(true);
    const quotes = (await offerten.getOffertenState(scope)).quotes;
    expect(quotes).toHaveLength(1);
    const feedback = await propose.proposeCore(scope, 'offerten.update_memory', {
      quoteId: quotes[0]!.id,
    }, { now: NOW });
    expect(feedback.awaitingApproval).toBe(true);
    expect((await offerten.getOffertenState(scope)).catalogue).toHaveLength(0);
  });

  it('invalidates pending send packages on edit and rejects stale edits', async () => {
    const quote = await draft();
    const pending = await propose.proposeCore(scope, 'offerten.send', { quoteId: quote.id, revision: quote.revision }, { now: NOW });
    const edits = { expectedRevision: quote.revision, positions: [{ id: quote.positions[0]!.id, unitPrice: 1800 }] };
    expect((await tools.runTool('offerten.edit', context(), { quoteId: quote.id, edits: JSON.stringify(edits) })).ok).toBe(true);
    expect((await tools.runTool('offerten.edit', context(), { quoteId: quote.id, edits: JSON.stringify(edits) })).ok).toBe(false);
    expect((await decide.approveToolCallAs(scope, pending.toolCallId, 'founder')).ok).toBe(false);
    expect((await offerten.getOffertenState(scope)).sends).toHaveLength(0);
  });

  it('preserves structured position and edit JSON beyond the generic text ceiling', async () => {
    const positions = Array.from({ length: 20 }, (_,index) => ({
      description: `Position ${index}: ${'x'.repeat(430)}`,
      quantity: 2, unit: 'h', cost: 1200, handPrice: 1700,
    }));
    const payload = JSON.stringify(positions);
    expect(payload.length).toBeGreaterThan(8000);
    expect((await tools.runTool('offerten.draft', context(), { ...args, positions: payload })).ok).toBe(true);
    const quote = (await offerten.getOffertenState(scope)).quotes[0]!;
    expect(quote.positions.map((position) => position.description)).toEqual(positions.map((position) => position.description));
    const ownerReason = `Private owner reasoning ${'y'.repeat(500)}`;
    const edits = JSON.stringify({
      expectedRevision: quote.revision,
      positions: quote.positions.map((position) => ({
        id: position.id, unitPrice: 1800, reason: { code: 'owner-edited', text: ownerReason },
      })),
    });
    expect(edits.length).toBeGreaterThan(8000);
    expect((await tools.runTool('offerten.edit', context(), { quoteId: quote.id, edits })).ok).toBe(true);
    const revised = (await offerten.getOffertenState(scope)).quotes[0]!;
    expect(revised.revision).toBe(quote.revision + 1);
    expect(revised.internal.positions.every((position) => position.commentary.includes(ownerReason))).toBe(true);
    expect(JSON.stringify(revised.documents.customer)).not.toContain(ownerReason);
  });

  it('explicitly rejects structured arguments over their declared bound before writes', async () => {
    const { getTool } = await import('@/lib/ai/tools');
    for (const [toolId, field] of [['offerten.draft', 'positions'], ['offerten.edit', 'edits']] as const) {
      const maxLength = getTool(toolId)?.params.find((param) => param.name === field)?.maxLength;
      expect(maxLength).toBe(512000);
      const before = await store.readScope(scope);
      const result = await tools.runTool(toolId, context(), {
        ...args, quoteId: 'quote_123', [field]: JSON.stringify({ value: 'x'.repeat(maxLength! + 1) }),
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain(`${field} must not exceed ${maxLength} characters`);
      expect(await store.readScope(scope)).toEqual(before);
    }
  });

  it('sends once under concurrent decisions and derives feedback only after persisted readback', async () => {
    const quote = await draft();
    const pending = await propose.proposeCore(scope, 'offerten.send', { quoteId: quote.id, revision: quote.revision }, { now: NOW });
    const results = await Promise.all([
      decide.approveToolCallAs(scope, pending.toolCallId, 'founder'),
      decide.approveToolCallAs(scope, pending.toolCallId, 'founder'),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const state = await offerten.getOffertenState(scope);
    expect(state.sends).toHaveLength(1);
    expect(state.catalogue.some((entry) => entry.id === quote.id)).toBe(true);
    const recorded = (await store.readCollection(scope, 'toolCalls')).find((call) => call.id === pending.toolCallId);
    expect(recorded).toMatchObject({ status: 'executed', decidedBy: 'founder' });
    expect(recorded?.decidedAt).toBeTruthy();
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it('does not expire a human decision because a fixture call waited a long time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      const quote = await draft();
      const pending = await propose.proposeCore(scope, 'offerten.send', {
        quoteId: quote.id, revision: quote.revision,
      }, { now: NOW });
      expect(pending.preview).toContain(quote.id);
      expect(pending.preview).toContain(`revision ${quote.revision}`);
      expect(pending.preview).toContain('company-private feedback');
      vi.setSystemTime(new Date('2066-11-20T04:00:00.000Z'));
      const waiting = await decide.findToolCall(scope, pending.toolCallId);
      expect(waiting?.status).toBe('awaiting-approval');
      expect(waiting).not.toHaveProperty('expiresAt');
      expect((await decide.approveToolCallAs(scope, pending.toolCallId, 'founder')).ok).toBe(true);
      expect((await offerten.getOffertenState(scope)).sends).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records rejection learning without promoting the quote into the catalogue', async () => {
    const quote = await draft();
    const pending = await propose.proposeCore(scope, 'offerten.send', { quoteId: quote.id, revision: quote.revision }, { now: NOW });
    const before = await offerten.getOffertenState(scope);
    expect(await decide.rejectToolCallAs(scope, pending.toolCallId, 'founder')).toBe(true);
    const after = await offerten.getOffertenState(scope);
    expect(after.catalogue).toEqual(before.catalogue);
    expect(after.sends).toHaveLength(0);
    expect(await store.readCollection(scope, 'memory')).toHaveLength(0);
    expect((await store.readCollection(scope, 'observations')).some((entry) => entry.text.includes('Rejects'))).toBe(true);
  });
});

describe('private source data never enters generic retrieval or cloud requests', () => {
  it('requires explicit local recall and never embeds its query', async () => {
    await privateMemories();
    const local = await recall.recallMemory({ scope, text: 'canary', localOnly: true, includeOfferten: true, now: NOW });
    expect(local.some((hit) => hit.record.text.includes(CANARY))).toBe(true);
    expect(mocks.embed).not.toHaveBeenCalled();
    const ordinary = await recall.recallMemory({ scope, text: 'canary', includeOfferten: true, now: NOW });
    expect(ordinary.map((hit) => hit.record.id)).toEqual(['public-memory']);
    expect(mocks.embed).toHaveBeenCalledWith(['canary']);
  });

  it('cannot widen private recall across spaces or into shared memory, even with cast options', async () => {
    await privateMemories();
    const shared = sharedScope('offerten');
    await store.insertRecords(shared, 'memory', [memory('shared-private', { scope: shared })]);
    const options = {
      text: 'canary', localOnly: true, includeOfferten: true, now: NOW,
    } as unknown as Parameters<typeof recall.recallAcrossSpaces>[1];
    const across = await recall.recallAcrossSpaces([
      { scope, label: 'Company' }, { scope: shared, label: 'Shared' },
    ], options);
    expect(across.map((hit) => hit.record.id)).toEqual(['public-memory']);
    const sharedHits = await recall.recallMemory({
      scope: shared, text: 'canary', localOnly: true, includeOfferten: true, now: NOW,
    });
    expect(sharedHits).toHaveLength(0);
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it('excludes private memories from generic search and get_record', async () => {
    await privateMemories();
    const search = await tools.runTool('search_workspace', context(), { query: 'canary', collection: 'memory' });
    expect(search.summary).not.toContain(CANARY);
    expect(search.summary).toContain('public operational lesson');
    for (const recordId of ['private-capability', 'private-tag']) {
      const read = await tools.runTool('get_record', context(), { collection: 'memory', recordId });
      expect(read.summary).not.toContain(CANARY);
      expect(read.summary).toContain('No memory record');
    }
  });

  it('does not expose raw private collections, private memories or tool payloads over MCP', async () => {
    await privateMemories();
    await propose.proposeCore(scope, 'offerten.draft', args, { now: NOW });
    expect((await mcp.handleOmniosTool('list_records', { scope: 'company:offerten-gates', collection: 'offerten' })).isError).toBe(true);
    const records = await mcp.handleOmniosTool('list_records', { scope: 'company:offerten-gates', collection: 'memory' });
    expect(records.text).not.toContain(CANARY);
    expect(records.text).toContain('public operational lesson');
    const calls = await mcp.handleOmniosTool('list_records', { scope: 'company:offerten-gates', collection: 'toolCalls' });
    expect(calls.text).not.toContain('Private Customer');
    const summary = await mcp.handleOmniosTool('get_scope_summary', { scope: 'company:offerten-gates' });
    expect(JSON.parse(summary.text)).not.toHaveProperty('offerten');
    expect(mcp.OMNIOS_MCP_TOOLS.find((tool) => tool.name === 'list_records')?.inputSchema.properties.collection.description).not.toContain('offerten');
  });

  it('keeps marked remember writes local, without embeddings or private result text', async () => {
    const outcome = await propose.proposeCore(scope, 'remember', {
      text: CANARY, capabilityId: 'offerten', tags: 'offerten-internal', kind: 'lesson',
    }, { now: NOW });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).not.toContain(CANARY);
    expect(mocks.embed).not.toHaveBeenCalled();
    expect((await recall.recallMemory({ scope, text: CANARY, now: NOW }))).toHaveLength(0);
    const payloads = await mcp.handleOmniosTool('list_records', { scope: 'company:offerten-gates', collection: 'toolCalls' });
    expect(payloads.text).not.toContain(CANARY);
    const { getTool } = await import('@/lib/ai/tools');
    expect(getTool('remember')?.preview({ text: CANARY, tags: 'offerten-internal' })).not.toContain(CANARY);
  });

  it('captures real assistant provider requests after search/get_record loop rounds', async () => {
    await draft();
    await privateMemories();
    await store.insertRecords(sharedScope('offerten'), 'memory', [
      memory('shared-private', { scope: sharedScope('offerten') }),
    ]);
    const ctx = await assistant.loadContext({ kind: 'space', scope }, NOW);
    expect(JSON.stringify(ctx)).not.toContain(CANARY);
    expect(ctx.slices[0]?.data.offerten).toHaveLength(0);
    mocks.plan
      .mockResolvedValueOnce({ text: '', calls: [{ name: 'search_workspace', args: { query: 'canary', collection: 'memory' } }] })
      .mockResolvedValueOnce({ text: '', calls: [{ name: 'get_record', args: { collection: 'memory', recordId: 'private-tag' } }] })
      .mockResolvedValueOnce({ text: '', calls: [] });
    await assistant.ask({ kind: 'space', scope }, 'Review canary operational lessons', NOW);
    expect(mocks.plan).toHaveBeenCalledTimes(3);
    expect(mocks.complete).toHaveBeenCalled();
    const captured = JSON.stringify([...mocks.plan.mock.calls, ...mocks.complete.mock.calls]);
    expect(captured).not.toContain(CANARY);
    expect(captured).not.toContain('Private Customer GmbH');
    expect(captured).not.toContain('Private Site Address');
    expect(captured).toContain('public operational lesson');
    expect(JSON.stringify(mocks.embed.mock.calls)).not.toContain(CANARY);
  });

  it('refuses untagged model writes and slash writes on the authoritative private surface', async () => {
    mocks.plan.mockResolvedValue({
      text: '', calls: [{ name: 'remember', args: { text: CANARY } }],
      providerId: 'capture', simulated: false,
    });
    const target = {
      kind: 'space' as const, scope,
      page: derivePageContext('/companies/offerten-gates/offerten'),
    };
    const result = await assistant.ask(target, `Store the calculation ${CANARY}`, NOW);
    expect(result.message.localOnly).toBe('offerten');
    expect(result.run.localOnly).toBe('offerten');
    expect(result.message.text).not.toContain(CANARY);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
    for (const command of [`/remember ${CANARY}`, `/doc Private calculation | ${CANARY}`]) {
      await assistant.ask(target, command, new Date(NOW.getTime() + 1000));
    }
    expect(await store.readCollection(scope, 'memory')).toHaveLength(0);
    expect(await store.readCollection(scope, 'docs')).toHaveLength(0);
    expect(await store.readCollection(scope, 'toolCalls')).toHaveLength(0);
    expect(await store.readCollection(scope, 'observations')).toHaveLength(0);
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    const privateData = await store.readScope(scope);
    expect(privateData.messages.every((message) => message.localOnly === 'offerten')).toBe(true);
    expect(privateData.agentRuns.every((run) => run.localOnly === 'offerten')).toBe(true);
    for (const collection of ['messages', 'agentRuns']) {
      const read = await mcp.handleOmniosTool('list_records', { scope: 'company:offerten-gates', collection });
      expect(read.text).not.toContain(CANARY);
    }
    mocks.plan.mockResolvedValue({ text: '', calls: [], providerId: 'capture', simulated: false });
    await assistant.ask({ kind: 'space', scope }, 'Review operational tasks', new Date(NOW.getTime() + 2000));
    expect(mocks.complete).toHaveBeenCalled();
    expect(JSON.stringify([...mocks.plan.mock.calls, ...mocks.complete.mock.calls])).not.toContain(CANARY);
    const deletion = await propose.proposeCore(scope, 'offerten.delete', {}, { now: NOW });
    expect((await decide.approveToolCallAs(scope, deletion.toolCallId, 'founder')).ok).toBe(true);
    expect(JSON.stringify(await store.readScope(scope))).not.toContain(CANARY);
  });

  it('keeps a directly mentioned Offerten specialist local without a page hint', async () => {
    await assistant.ask({ kind: 'space', scope }, `@offerten remember ${CANARY}`, NOW);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(await store.readCollection(scope, 'memory')).toHaveLength(0);
    expect((await store.readCollection(scope, 'messages')).every((message) => message.localOnly === 'offerten')).toBe(true);
    const { speakToAgent } = await import('@/lib/actions/agents');
    expect((await speakToAgent('company:offerten-gates', 'offerten', CANARY)).ok).toBe(true);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
    expect((await store.readCollection(scope, 'messages')).every((message) => message.localOnly === 'offerten')).toBe(true);
  });

  it('keeps comparison and export details out of subsequent planner prompts', async () => {
    const quote = await draft();
    const requests: LlmRequest[] = [];
    let round = 0;
    const provider: LlmProvider = {
      id: 'capture-loop', label: 'Capture loop', simulated: false, keyName: null,
      available: async () => true,
      complete: mocks.complete,
      completeWithTools: async (request, schemas) => {
        requests.push(request);
        const id = round++ === 0 ? 'offerten.compare' : round === 2 ? 'offerten.export' : null;
        const name = id ? schemas.find((schema) => schema.name.includes(id.replace('.', '_')))?.name : undefined;
        return { text: '', calls: name ? [{ name, args: id === 'offerten.compare' ? { quoteId: quote.id } : {} }] : [], providerId: 'capture-loop', simulated: false };
      },
    };
    const { runActLoop } = await import('@/lib/ai/loop');
    const result = await runActLoop('compare offerte then export offerten', { scope, provider, now: NOW });
    expect(result.steps.map((step) => step.toolId)).toEqual(['offerten.compare', 'offerten.export']);
    expect(JSON.stringify(requests)).not.toContain('Private Customer');
    expect(JSON.stringify(requests)).not.toContain('"cost":1200');
    expect(JSON.stringify(requests)).not.toContain('Owner review work');
  });

  it('blocks local-only memory promotion even after rewriting its text', async () => {
    await privateMemories();
    const outcome = await promotion.promoteMemory(
      'company:offerten-gates', 'private-tag', 'A completely generic lesson that otherwise passes.', 'lesson',
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.violations.join(' ')).toContain('cannot be promoted');
    expect((await promotion.checkPromotion('company:offerten-gates', 'Private Customer GmbH is a useful customer.')).allowed).toBe(true);
    await draft();
    expect((await promotion.checkPromotion('company:offerten-gates', 'Private Customer GmbH is a useful customer.')).allowed).toBe(false);
    expect(promotionCheck('Private Customer GmbH paid CHF 900.', ['Private Customer GmbH']).allowed).toBe(false);
    expect(await store.readCollection(sharedScope('offerten'), 'memory')).toHaveLength(0);
  });

  it('deletes private generic-memory call payloads but retains their decision metadata', async () => {
    await store.saveWorkspace((root) => ({ ...root, settings: { ...root.settings, confirmWrites: true } }));
    const remembered = await propose.proposeCore(scope, 'remember', {
      text: CANARY, tags: 'offerten-internal', kind: 'lesson',
    }, { now: NOW });
    expect((await decide.approveToolCallAs(scope, remembered.toolCallId, 'founder')).ok).toBe(true);
    const deletion = await propose.proposeCore(scope, 'offerten.delete', {}, { now: NOW });
    expect((await decide.approveToolCallAs(scope, deletion.toolCallId, 'founder')).ok).toBe(true);
    const data = await store.readScope(scope);
    expect(JSON.stringify(data)).not.toContain(CANARY);
    expect(data.toolCalls.find((call) => call.id === remembered.toolCallId)).toMatchObject({
      args: {}, decidedBy: 'founder', status: 'executed',
    });
  });
});
