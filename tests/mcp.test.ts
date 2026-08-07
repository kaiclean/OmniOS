import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { McpServerConfig, McpToolDescriptor, RiskTier } from '@/lib/domain';
import { RISK_TIERS, mcpToolId, parseMcpToolId, requiresApproval, riskForMcpTool } from '@/lib/domain';
import { mcpToolDefinition, mcpToolDefinitions, paramsFromSchema } from '@/lib/ai/tools/mcp-bridge';

/**
 * The MCP layer is the door to everything outside this workspace, so it is
 * tested against a real server speaking the real protocol over a real stdio
 * transport — not a mock. A mocked MCP client would prove only that the mock
 * matches my assumptions about MCP, which is the thing most likely to be wrong.
 */

let dir: string;
let serverPath: string;
let client: typeof import('@/lib/mcp/client');

function config(patch: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'test-server',
    name: 'Test server',
    description: 'A local server used by the test suite.',
    transport: 'stdio',
    command: process.execPath,
    args: [serverPath],
    enabled: true,
    autonomy: 'ask-always',
    capabilityId: 'research',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    disabledTools: [],
    ...patch,
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-mcp-'));
  process.env.OMNIOS_DATA_DIR = dir;
  // Inside the repo so the child can resolve the MCP SDK from node_modules.
  serverPath = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
  client = await import('@/lib/mcp/client');
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('probing a server', () => {
  it('connects, reports identity, and lists what it offers', async () => {
    const state = await client.probeServer(config());
    expect(state.status).toBe('connected');
    expect(state.serverName).toBe('test-server');
    expect(state.serverVersion).toBe('1.2.3');
    expect(state.tools.map((t) => t.name).sort()).toEqual(['echo_env', 'publish_post', 'search_web']);
    expect(state.latencyMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('hides tools the founder switched off', async () => {
    const state = await client.probeServer(config({ disabledTools: ['publish_post'] }));
    expect(state.tools.map((t) => t.name)).not.toContain('publish_post');
    expect(state.tools.map((t) => t.name)).toContain('search_web');
  }, 60_000);

  it('reports a disabled server without spawning anything', async () => {
    const state = await client.probeServer(config({ enabled: false }));
    expect(state.status).toBe('disabled');
    expect(state.tools).toEqual([]);
  });

  it('returns an error state rather than throwing when the command does not exist', async () => {
    const state = await client.probeServer(config({ command: '/nonexistent/omnios-nope' }));
    expect(state.status).toBe('error');
    expect(state.error).toBeTruthy();
    expect(state.tools).toEqual([]);
  }, 60_000);

  it('refuses a plaintext http endpoint that is not localhost', async () => {
    const state = await client.probeServer(
      config({ transport: 'http', url: 'http://example.com/mcp', command: undefined }),
    );
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/https/i);
  }, 60_000);
});

describe('calling a tool', () => {
  it('returns the text content on success', async () => {
    const result = await client.callMcpTool(config(), 'search_web', { q: 'omnios' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('results for: omnios');
  }, 60_000);

  it('surfaces a server-reported error as a failure rather than a success', async () => {
    const result = await client.callMcpTool(config(), 'publish_post', { text: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.isError).toBe(true);
  }, 60_000);

  it('refuses a tool the founder disabled, without contacting the server', async () => {
    const result = await client.callMcpTool(config({ disabledTools: ['search_web'] }), 'search_web', {});
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/switched off/i);
    expect(result.durationMs).toBe(0);
  });

  it('refuses when the server is disabled', async () => {
    const result = await client.callMcpTool(config({ enabled: false }), 'search_web', {});
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/disabled/i);
  });

  it('passes declared env through and withholds the ambient environment', async () => {
    process.env.OMNIOS_MCP_LEAK_CHECK = 'must-not-be-visible';
    const withEnv = config({ env: { DECLARED: 'declared-value' } });

    const declared = await client.callMcpTool(withEnv, 'echo_env', { key: 'DECLARED' });
    expect(declared.text).toBe('declared-value');

    // A third-party server must not inherit every key on the machine.
    const leaked = await client.callMcpTool(withEnv, 'echo_env', { key: 'OMNIOS_MCP_LEAK_CHECK' });
    expect(leaked.text).toBe('');

    delete process.env.OMNIOS_MCP_LEAK_CHECK;
  }, 60_000);

  it('resolves a secret placeholder into the child environment, never into the config', async () => {
    const vault = await import('@/lib/secrets/vault');
    await vault.putSecret({ name: 'MCP_TEST_KEY', value: 'resolved-secret-value', kind: 'api-key' });

    const withSecret = config({ env: { API_KEY: '{{secret:MCP_TEST_KEY}}' } });
    const result = await client.callMcpTool(withSecret, 'echo_env', { key: 'API_KEY' });

    expect(result.text).toBe('resolved-secret-value');
    // The config the caller holds still carries only the placeholder.
    expect(withSecret.env?.API_KEY).toBe('{{secret:MCP_TEST_KEY}}');
  }, 60_000);
});

describe('risk assignment for remote tools', () => {
  it('treats an unrecognised tool as external, whatever it is called', () => {
    expect(riskForMcpTool('do_something_unknown', 'ask-always')).toBe('external');
    expect(riskForMcpTool('publish_post', 'ask-always')).toBe('external');
    expect(riskForMcpTool('list_files', 'ask-always')).toBe('external');
  });

  it('lets read-shaped names run only when the founder loosened the server', () => {
    expect(riskForMcpTool('list_files', 'ask-writes')).toBe('read');
    expect(riskForMcpTool('search_web', 'ask-writes')).toBe('read');
    expect(riskForMcpTool('publish_post', 'ask-writes')).toBe('external');
  });

  it('never returns destructive — a remote tool is external or nothing', () => {
    for (const autonomy of ['ask-always', 'ask-writes', 'trusted'] as const) {
      for (const name of ['delete_everything', 'drop_table', 'list_x', 'post_y']) {
        expect(riskForMcpTool(name, autonomy)).not.toBe('destructive');
      }
    }
  });
});

describe('bridging a remote tool into the tool layer', () => {
  function descriptor(patch: Partial<McpToolDescriptor> = {}): McpToolDescriptor {
    return {
      serverId: 'test-server',
      name: 'publish_post',
      description: 'Publish a post to the connected account.',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'The body of the post.' },
          scheduleAt: { type: 'string' },
          audience: { type: 'string', enum: ['public', 'followers'] },
          repeat: { type: 'integer', default: 1 },
          draft: { type: 'boolean' },
          media: { type: 'array' },
        },
      },
      risk: 'external',
      ...patch,
    };
  }

  it('reads parameters out of the server-declared schema', () => {
    const params = paramsFromSchema(descriptor().inputSchema);
    const byName = new Map(params.map((param) => [param.name, param]));

    expect(byName.get('text')?.required).toBe(true);
    expect(byName.get('text')?.description).toBe('The body of the post.');
    expect(byName.get('scheduleAt')?.required).toBe(false);
    expect(byName.get('audience')?.type).toBe('enum');
    expect(byName.get('audience')?.enumValues).toEqual(['public', 'followers']);
    expect(byName.get('repeat')?.type).toBe('number');
    expect(byName.get('repeat')?.default).toBe(1);
    expect(byName.get('draft')?.type).toBe('boolean');
    // Structured arguments survive a flat form as JSON text, and stay readable
    // in the approval preview rather than becoming "[object Object]".
    expect(byName.get('media')?.type).toBe('text');
  });

  it('survives a server that describes its tool badly', () => {
    expect(paramsFromSchema({})).toEqual([]);
    expect(paramsFromSchema({ properties: 'nonsense' })).toEqual([]);
    expect(paramsFromSchema({ properties: { x: null } })).toHaveLength(1);
  });

  it('names the server in the preview, because the account matters', () => {
    const tool = mcpToolDefinition(config({ name: 'Brand X Instagram' }), descriptor());
    const preview = tool.preview({ text: 'Launching today' });

    expect(preview).toContain('Brand X Instagram');
    expect(preview).toContain('publish_post');
    expect(preview).toContain('Launching today');
    expect(preview).toMatch(/outside OmniOS/i);
  });

  it('cannot run without an approval, whatever the server called it', () => {
    const tool = mcpToolDefinition(config(), descriptor());
    expect(tool.risk).toBe('external');
    expect(requiresApproval(tool.risk)).toBe(true);
  });

  it('hides tools from a server that is switched off', () => {
    const enabled = mcpToolDefinitions(
      [config()],
      [{ serverId: 'test-server', tools: [descriptor()] }],
    );
    expect(enabled).toHaveLength(1);

    const disabledServer = mcpToolDefinitions(
      [config({ enabled: false })],
      [{ serverId: 'test-server', tools: [descriptor()] }],
    );
    expect(disabledServer).toEqual([]);

    // The probe snapshot predates the founder switching the tool off, so the
    // config has to win over the cache.
    const disabledTool = mcpToolDefinitions(
      [config({ disabledTools: ['publish_post'] })],
      [{ serverId: 'test-server', tools: [descriptor()] }],
    );
    expect(disabledTool).toEqual([]);
  });

  it('namespaces every bridged tool so none can shadow a built-in', () => {
    const tool = mcpToolDefinition(config(), descriptor({ name: 'create_task' }));
    expect(tool.id).toBe('mcp:test-server:create_task');
    expect(tool.id).not.toBe('create_task');
  });
});

describe('the approval policy', () => {
  it('lets the founder tighten the gate onto writes', () => {
    expect(requiresApproval('write')).toBe(false);
    expect(requiresApproval('write', { confirmWrites: true })).toBe(true);
    expect(requiresApproval('read', { confirmWrites: true })).toBe(false);
  });

  it('offers no policy at all that would let the gated tiers run themselves', () => {
    const gated: RiskTier[] = ['destructive', 'external'];
    for (const risk of gated) {
      for (const policy of [{}, { confirmWrites: false }, { confirmWrites: true }]) {
        expect(requiresApproval(risk, policy)).toBe(true);
      }
    }
    // And every tier is accounted for, so a new one cannot appear ungated by
    // default without this failing.
    expect(RISK_TIERS.filter((risk) => !requiresApproval(risk)).sort()).toEqual(['read', 'write']);
  });
});

describe('tool identifiers', () => {
  it('round-trips, and namespaces so a remote tool cannot shadow a built-in', () => {
    const id = mcpToolId('github', 'create_issue');
    expect(id).toBe('mcp:github:create_issue');
    expect(parseMcpToolId(id)).toEqual({ serverId: 'github', toolName: 'create_issue' });
  });

  it('handles a tool name containing a colon', () => {
    expect(parseMcpToolId('mcp:srv:name:with:colons')).toEqual({
      serverId: 'srv',
      toolName: 'name:with:colons',
    });
  });

  it('rejects anything that is not an mcp id', () => {
    expect(parseMcpToolId('create_task')).toBeNull();
    expect(parseMcpToolId('mcp:')).toBeNull();
    expect(parseMcpToolId('mcp:srv:')).toBeNull();
  });
});
