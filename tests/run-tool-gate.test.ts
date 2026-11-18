import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ToolArgs, ToolContext, ToolDefinition } from '@/lib/domain';
import { personalScope, requiresApproval } from '@/lib/domain';

/**
 * The approval gate, exercised through `runTool` itself.
 *
 * `tests/tools.test.ts` pins `requiresApproval` as a pure function. That alone
 * would still pass if someone deleted the call to it from `runTool`, so these
 * tests go through the real entry point against a real (temporary) store and
 * assert on what happened to the data. Remove the check in `runTool` and the
 * destructive case below deletes a record without a decision: the test goes red.
 */

const NOW = new Date('2026-11-18T09:00:00.000Z');
const WAITING = /waiting for your decision/;
const APPROVAL = { decidedBy: 'test-founder', decidedAt: NOW.toISOString() };

let dir: string;
let executors: typeof import('@/lib/ai/tools/executors');
let tools: typeof import('@/lib/ai/tools');
let store: typeof import('@/lib/data/store');

const ctx = (callId: string): ToolContext => ({
  scope: personalScope(),
  now: NOW,
  actor: 'test',
  resolveSecrets: async (value) => value,
  callId,
});

/** Smallest arguments that pass validation for a tool, by declared type. */
function minimalArgs(tool: ToolDefinition): ToolArgs {
  const args: Record<string, string | number | boolean> = {};
  for (const param of tool.params) {
    if (!param.required) continue;
    if (param.type === 'enum') args[param.name] = param.enumValues?.[0] ?? '';
    else if (param.type === 'number') args[param.name] = 1;
    else if (param.type === 'boolean') args[param.name] = true;
    else if (param.type === 'date') args[param.name] = '2026-11-18';
    else if (param.type === 'scope') args[param.name] = 'personal';
    else args[param.name] = 'gate test';
  }
  return args;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-gate-'));
  process.env.OMNIOS_DATA_DIR = dir;
  executors = await import('@/lib/ai/tools/executors');
  tools = await import('@/lib/ai/tools');
  store = await import('@/lib/data/store');
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('runTool and the destructive tier', () => {
  it('does not delete without a recorded decision, and does with one', async () => {
    const created = await executors.runTool('create_task', ctx('gate-create'), { title: 'Gate test task' });
    expect(created.ok).toBe(true);
    const id = created.affectedIds?.[0] ?? '';
    expect(id).not.toBe('');

    const refused = await executors.runTool(
      'delete_record',
      ctx('gate-delete-1'),
      { collection: 'tasks', recordId: id },
    );
    expect(refused.ok).toBe(false);
    expect(refused.summary).toMatch(WAITING);
    const stillThere = await store.readCollection(personalScope(), 'tasks');
    expect(stillThere.some((task) => task.id === id)).toBe(true);

    const approved = await executors.runTool(
      'delete_record',
      ctx('gate-delete-2'),
      { collection: 'tasks', recordId: id },
      { approval: APPROVAL },
    );
    expect(approved.ok).toBe(true);
    const gone = await store.readCollection(personalScope(), 'tasks');
    expect(gone.some((task) => task.id === id)).toBe(false);
  });
});

describe('runTool and every gated built-in tool', () => {
  const gated = () => tools.TOOLS.filter((tool) => requiresApproval(tool.risk));

  it('has gated tools in both the destructive and the external tier', () => {
    const tiers = new Set(gated().map((tool) => tool.risk));
    expect(tiers.has('destructive')).toBe(true);
    expect(tiers.has('external')).toBe(true);
  });

  it('waits for a decision on each of them, whatever the arguments', async () => {
    for (const tool of gated()) {
      const outcome = await executors.runTool(tool.id, ctx(`gate-${tool.id}`), minimalArgs(tool));
      expect(outcome.ok, `${tool.id} must not run without a decision`).toBe(false);
      expect(outcome.summary, tool.id).toMatch(WAITING);
    }
  });

  it('reaches the executor once approved: the unwired external tools refuse for their own reason', async () => {
    for (const id of executors.NOT_WIRED_TOOL_IDS) {
      const tool = tools.getTool(id);
      expect(tool?.risk, id).toBe('external');
      const outcome = await executors.runTool(id, ctx(`gate-ok-${id}`), minimalArgs(tool!), {
        approval: APPROVAL,
      });
      expect(outcome.ok, id).toBe(false);
      expect(outcome.summary, id).not.toMatch(WAITING);
      expect(outcome.summary, id).toMatch(/approved but not performed/);
    }
  });
});

describe('runTool and the founder’s own tightening', () => {
  it('holds a write tool for approval once confirmWrites is on, and not before', async () => {
    const open = await executors.runTool('create_task', ctx('gate-write-1'), { title: 'Runs freely' });
    expect(open.ok).toBe(true);

    await store.saveWorkspace((current) => ({
      ...current,
      settings: { ...current.settings, confirmWrites: true },
    }));
    const held = await executors.runTool('create_task', ctx('gate-write-2'), { title: 'Held for approval' });
    expect(held.ok).toBe(false);
    expect(held.summary).toMatch(WAITING);
    const tasks = await store.readCollection(personalScope(), 'tasks');
    expect(tasks.some((task) => task.title === 'Held for approval')).toBe(false);

    await store.saveWorkspace((current) => ({
      ...current,
      settings: { ...current.settings, confirmWrites: false },
    }));
  });

  it('never lets a read tool wait', async () => {
    const outcome = await executors.runTool('search_workspace', ctx('gate-read'), { query: 'anything' });
    expect(outcome.summary).not.toMatch(WAITING);
  });
});
