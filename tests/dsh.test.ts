import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { McpServerConfig } from '@/lib/domain';
import { MCP_PRESETS, configGaps, riskForMcpTool } from '@/lib/domain';

/**
 * The DeepSeek Harness integration is two doors, both of which must obey the
 * house rules without being trusted to:
 *
 * - ops/dsh/dsh-mcp-server.mjs (OmniOS -> dsh) is spoken to over a real stdio
 *   transport, like the rest of the MCP layer's tests, because the property
 *   that matters — a secret-shaped task is refused before dsh ever spawns —
 *   only counts if it holds across the real protocol.
 * - lib/mcp/serve.ts (dsh -> OmniOS) is tested at the handler seam: every read
 *   names a scope, refuses without one, and nothing mutates.
 */

let dir: string;
let client: typeof import('@/lib/mcp/client');
let serve: typeof import('@/lib/mcp/serve');
let wrapperPath: string;

function wrapperConfig(patch: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'deepseek-harness',
    name: 'DeepSeek Harness',
    description: 'The dsh headless wrapper.',
    transport: 'stdio',
    command: process.execPath,
    args: [wrapperPath],
    // Guarantees any spawn attempt fails instantly instead of downloading dsh
    // in CI — the tests below must never get far enough for this to matter.
    env: { DSH_COMMAND: '/nonexistent-dsh-binary' },
    enabled: true,
    autonomy: 'ask-always',
    capabilityId: 'development',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    disabledTools: [],
    ...patch,
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-dsh-'));
  process.env.OMNIOS_DATA_DIR = dir;
  wrapperPath = fileURLToPath(new URL('../ops/dsh/dsh-mcp-server.mjs', import.meta.url));
  client = await import('@/lib/mcp/client');
  serve = await import('@/lib/mcp/serve');
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('the deepseek-harness preset', () => {
  const preset = MCP_PRESETS.find((entry) => entry.id === 'deepseek-harness');

  it('exists, is stdio, and suggests ask-always autonomy', () => {
    expect(preset).toBeDefined();
    expect(preset?.transport).toBe('stdio');
    expect(preset?.suggestedAutonomy).toBe('ask-always');
  });

  it('is needs-setup until the wrapper path placeholder is replaced', () => {
    const gaps = configGaps({
      transport: 'stdio',
      args: preset?.args ?? [],
    });
    expect(gaps).toEqual(['the absolute path to ops/dsh/dsh-mcp-server.mjs']);
  });
});

describe('risk tiers for the wrapper tools', () => {
  it('run_task is external under every non-trusted autonomy', () => {
    expect(riskForMcpTool('run_task', 'ask-always')).toBe('external');
    expect(riskForMcpTool('run_task', 'ask-writes')).toBe('external');
  });

  it('harness_status is read-only only when the founder chose ask-writes', () => {
    expect(riskForMcpTool('harness_status', 'ask-always')).toBe('external');
    expect(riskForMcpTool('harness_status', 'ask-writes')).toBe('read');
  });
});

describe('the dsh wrapper over real stdio', () => {
  it('advertises exactly run_task and harness_status', async () => {
    const state = await client.probeServer(wrapperConfig());
    expect(state.status).toBe('connected');
    expect(state.tools.map((tool) => tool.name).sort()).toEqual([
      'harness_status',
      'run_task',
    ]);
    // Under ask-always both are gated: nothing this server does runs itself.
    for (const tool of state.tools) {
      expect(tool.risk).toBe('external');
    }
  }, 30_000);

  it('refuses a task carrying a {{secret:NAME}} placeholder before spawning dsh', async () => {
    const result = await client.callMcpTool(wrapperConfig(), 'run_task', {
      task: 'Deploy using {{secret:DEPLOY_KEY}} as the token.',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Refused');
    expect(result.text).toContain('{{secret:NAME}} placeholder');
  }, 30_000);

  it('refuses a task carrying credential-shaped plaintext', async () => {
    const result = await client.callMcpTool(wrapperConfig(), 'run_task', {
      task: `Use ghp_${'a'.repeat(36)} to push the branch.`,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Refused');
  }, 30_000);

  it('refuses an empty task', async () => {
    const result = await client.callMcpTool(wrapperConfig(), 'run_task', { task: '   ' });
    expect(result.isError).toBe(true);
  }, 30_000);
});

describe('the OmniOS MCP server handlers', () => {
  it('lists spaces as ids and names only', async () => {
    const result = await serve.handleOmniosTool('list_spaces', {});
    expect(result.isError).toBe(false);
    const spaces = JSON.parse(result.text) as { scope: string; name: string }[];
    expect(spaces[0]?.scope).toBe('personal');
    for (const space of spaces) {
      expect(Object.keys(space).sort()).toEqual(['name', 'scope']);
    }
  });

  it('refuses a read with no scope', async () => {
    const summary = await serve.handleOmniosTool('get_scope_summary', {});
    expect(summary.isError).toBe(true);
    const records = await serve.handleOmniosTool('list_records', { collection: 'tasks' });
    expect(records.isError).toBe(true);
  });

  it('refuses a malformed scope key', async () => {
    const result = await serve.handleOmniosTool('get_scope_summary', { scope: 'everything' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not a scope key');
  });

  it('summarises one scope as counts per collection', async () => {
    const result = await serve.handleOmniosTool('get_scope_summary', { scope: 'personal' });
    expect(result.isError).toBe(false);
    const counts = JSON.parse(result.text) as Record<string, number>;
    expect(typeof counts.tasks).toBe('number');
  });

  it('reads records from one collection in one scope, and refuses unknown collections', async () => {
    const result = await serve.handleOmniosTool('list_records', {
      scope: 'personal',
      collection: 'tasks',
      limit: 5,
    });
    expect(result.isError).toBe(false);
    expect(Array.isArray(JSON.parse(result.text))).toBe(true);

    const bad = await serve.handleOmniosTool('list_records', {
      scope: 'personal',
      collection: 'secrets',
    });
    expect(bad.isError).toBe(true);
  });

  it('exposes no mutating tool', () => {
    expect(serve.OMNIOS_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      'list_spaces',
      'get_scope_summary',
      'list_records',
    ]);
    for (const tool of serve.OMNIOS_MCP_TOOLS) {
      // The same word-token risk deriver the product uses must read every tool
      // on this server as read-only under ask-writes — proof the surface stays
      // reads-only by name as well as by implementation.
      expect(riskForMcpTool(tool.name, 'ask-writes')).toBe('read');
    }
  });
});
