import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { McpServerConfig, McpToolDescriptor, RiskTier } from '@/lib/domain';
import {
  RISK_TIERS,
  configGaps,
  connectionStatusFor,
  mcpToolId,
  parseMcpToolId,
  presetOwnsServerId,
  requiresApproval,
  riskForMcpTool,
  MCP_PRESETS,
} from '@/lib/domain';
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

  it('matches read hints as whole words, so a mutating name that merely starts read-ish still gates', () => {
    // 'checkout_cart' starts with 'check' but buys something; 'get_or_create'
    // and 'fetch_and_store' read AND mutate. None may run unattended.
    for (const name of ['checkout_cart', 'get_or_create_customer', 'fetch_and_store', 'listing_create']) {
      expect(riskForMcpTool(name, 'ask-writes'), name).toBe('external');
    }
    // camelCase is tokenised too.
    expect(riskForMcpTool('getInvoice', 'ask-writes')).toBe('read');
    expect(riskForMcpTool('createInvoice', 'ask-writes')).toBe('external');
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

/**
 * Preset commands have to be real.
 *
 * `@modelcontextprotocol/server-fetch` shipped in the preset list and does not
 * exist — the npm registry returns 404 for it, and always has. Web fetch is the
 * connection most often recommended as the easy first one, so the failure landed
 * on precisely the founder least equipped to work out why. A preset that names
 * an uninstallable package is worse than no preset: it looks like a supported
 * path and dead-ends.
 *
 * The offline half runs always. The network half runs when asked, because a test
 * that reaches the npm registry has no business failing a build over someone
 * else's outage.
 */
describe('unfilled placeholders', () => {
  it('names every gap a preset ships, in founder words', () => {
    const byId = (id: string) => {
      const preset = MCP_PRESETS.find((candidate) => candidate.id === id);
      if (!preset) throw new Error(`no preset ${id}`);
      return preset;
    };
    expect(configGaps(byId('filesystem'))).toEqual(['a directory path']);
    expect(configGaps(byId('postgres'))).toEqual(['a connection string']);
    expect(configGaps(byId('custom-http'))).toEqual(['its real URL']);
    // Ready-to-run presets must never be told they need something.
    expect(configGaps(byId('fetch'))).toEqual([]);
    expect(configGaps(byId('playwright'))).toEqual([]);
  });

  it('names every placeholder in a single argument, not just the first', () => {
    const gaps = configGaps({
      transport: 'stdio',
      args: ['postgresql://<USER>:<PASSWORD>@localhost/db'],
    });
    expect(gaps).toEqual(['a value for <USER>', 'a value for <PASSWORD>']);
  });

  it('outranks any stored probe result — a probe of a placeholder config describes nothing', () => {
    const unfilled = config({ args: ['-y', 'some-server', '<ABSOLUTE_PATH>'] });
    expect(connectionStatusFor(unfilled, { status: 'error' })).toBe('needs-setup');
    expect(connectionStatusFor(unfilled, undefined)).toBe('needs-setup');
  });

  it('drops a stale needs-setup once the founder fills the placeholder in', () => {
    expect(connectionStatusFor(config(), { status: 'needs-setup' })).toBe('never-connected');
  });

  it('keeps disabled above everything, and passes real statuses through', () => {
    expect(connectionStatusFor(config({ enabled: false }), { status: 'connected' })).toBe('disabled');
    expect(connectionStatusFor(config(), { status: 'error' })).toBe('error');
    expect(connectionStatusFor(config(), undefined)).toBe('never-connected');
  });
});

describe('the spawn PATH', () => {
  it('appends the tool dirs a launchd-started app lacks, after whatever was inherited', () => {
    const path = client.augmentedPath('/usr/bin:/bin');
    expect(path.startsWith('/usr/bin:/bin:')).toBe(true);
    expect(path.split(':')).toContain('/opt/homebrew/bin');
    expect(path.split(':')).toContain('/usr/local/bin');
  });

  it('never duplicates a dir that is already on PATH', () => {
    const path = client.augmentedPath('/opt/homebrew/bin:/usr/bin');
    expect(path.split(':').filter((dir) => dir === '/opt/homebrew/bin')).toHaveLength(1);
  });
});

describe('preset upstreams', () => {
  it('runs the browser through the maintained Playwright server, never the archived puppeteer one', () => {
    const browser = MCP_PRESETS.find((preset) => preset.name === 'Browser');
    expect(browser?.args?.join(' ')).toContain('@playwright/mcp');
    for (const preset of MCP_PRESETS) {
      expect(preset.args?.join(' ') ?? '', preset.id).not.toContain('server-puppeteer');
    }
  });

  it('still owns servers added under the former preset id, so no workspace is orphaned', () => {
    const browser = MCP_PRESETS.find((preset) => preset.name === 'Browser');
    if (!browser) throw new Error('no browser preset');
    expect(presetOwnsServerId(browser, 'puppeteer')).toBe(true);
    expect(presetOwnsServerId(browser, 'puppeteer-2')).toBe(true);
    expect(presetOwnsServerId(browser, 'playwright')).toBe(true);
    // Prefix without the separator is a different server, not a copy.
    expect(presetOwnsServerId(browser, 'puppeteer2')).toBe(false);
  });
});

describe('preset commands are installable', () => {
  it('runs each stdio preset through a launcher the founder can be told to install', () => {
    const launchers = new Set(['npx', 'uvx', 'docker']);
    for (const preset of MCP_PRESETS) {
      if (preset.transport !== 'stdio') continue;
      expect(launchers, preset.id).toContain(preset.command);
      expect(preset.args?.length ?? 0, `${preset.id} names no package`).toBeGreaterThan(0);
    }
  });

  it('names a package on the right registry for its launcher', () => {
    for (const preset of MCP_PRESETS) {
      if (preset.transport !== 'stdio') continue;
      const pkg = (preset.args ?? []).find((arg) => !arg.startsWith('-') && !arg.startsWith('<'));
      expect(pkg, `${preset.id} names no package`).toBeTruthy();
      // npm packages are scoped or bare names; uvx packages are PyPI names. What
      // matters is that one of them is identifiable at all.
      expect(pkg, preset.id).toMatch(/^[@a-z0-9][\w@/.-]*$/i);
    }
  });

  it.runIf(process.env.OMNIOS_CHECK_REGISTRIES === '1')(
    'every named package actually resolves',
    async () => {
      for (const preset of MCP_PRESETS) {
        if (preset.transport !== 'stdio') continue;
        const pkg = (preset.args ?? []).find((arg) => !arg.startsWith('-') && !arg.startsWith('<'));
        if (!pkg) continue;
        const url =
          preset.command === 'uvx'
            ? `https://pypi.org/pypi/${pkg}/json`
            : `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
        const response = await fetch(url);
        expect(response.ok, `${preset.id} → ${pkg} (${response.status})`).toBe(true);
      }
    },
    120_000,
  );
});
