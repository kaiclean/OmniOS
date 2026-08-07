import 'server-only';

/**
 * The MCP client.
 *
 * Connections are made per operation and closed afterwards rather than held
 * open. That costs a process spawn on every stdio call, and it is the right
 * trade for this app: a Next dev server hot-reloads constantly, and a cached
 * child process outlives the module that owns it. Leaking a browser or a
 * database connection on every edit is a worse problem than a slow call.
 *
 * The consequence is that tool *listings* must not be fetched on render. They
 * are probed on demand and persisted, so pages read a stored snapshot.
 *
 * Credentials reach this file only as `{{secret:NAME}}` placeholders and are
 * resolved immediately before the transport is constructed. The resolved values
 * live in the transport's env or headers for the duration of one call and are
 * never returned, logged, or written back to the config.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { McpConnectionState, McpServerConfig, McpToolDescriptor } from '@/lib/domain';
import { riskForMcpTool } from '@/lib/domain';
import { resolveSecrets } from '@/lib/secrets/vault';

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;

async function resolveRecord(
  record: Readonly<Record<string, string>> | undefined,
): Promise<Record<string, string>> {
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = await resolveSecrets(value);
  }
  return out;
}

/**
 * A stdio server inherits only what it is explicitly given plus the handful of
 * variables a Node process genuinely needs to run. Passing the whole ambient
 * environment would hand every third-party server every key on the machine.
 */
const INHERITED_ENV = ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'LANG', 'USER', 'NODE_EXTRA_CA_CERTS'];

function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of INHERITED_ENV) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function buildTransport(config: McpServerConfig) {
  if (config.transport === 'stdio') {
    if (!config.command) throw new Error('A stdio server needs a command.');
    const env = { ...baseEnv(), ...(await resolveRecord(config.env)) };
    return new StdioClientTransport({
      command: config.command,
      args: [...(config.args ?? [])],
      env,
      stderr: 'pipe',
    });
  }

  if (!config.url) throw new Error('An HTTP server needs a URL.');
  const url = new URL(config.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('An HTTP MCP server must use https, or be on localhost.');
  }
  const headers = await resolveRecord(config.headers);
  return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
}

async function withClient<T>(
  config: McpServerConfig,
  timeoutMs: number,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(
    { name: 'omnios', version: '0.1.0' },
    { capabilities: {} },
  );
  const transport = await buildTransport(config);

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${config.name} did not respond within ${timeoutMs / 1000}s.`)), timeoutMs);
  });

  try {
    await Promise.race([client.connect(transport), timeout]);
    return await Promise.race([work(client), timeout]);
  } finally {
    // Always tear the process or socket down, including on timeout — this is the
    // whole reason connections are not cached.
    await client.close().catch(() => undefined);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Node's spawn failures are unhelpful on their own; name the likely cause.
    if (error.message.includes('ENOENT')) {
      return `Command not found. Check that it is installed and on PATH. (${error.message})`;
    }
    return error.message;
  }
  return String(error);
}

/**
 * Connect, list what the server offers, disconnect.
 *
 * Never throws: a failed probe is a state the UI renders, not an exception that
 * takes a page down. The error text is kept verbatim because it is usually the
 * only clue a founder gets about why their server will not start.
 */
export async function probeServer(config: McpServerConfig): Promise<McpConnectionState> {
  const checkedAt = new Date().toISOString();

  if (!config.enabled) {
    return { serverId: config.id, status: 'disabled', tools: [], checkedAt };
  }

  const started = Date.now();
  try {
    return await withClient(config, CONNECT_TIMEOUT_MS, async (client) => {
      const listed = await client.listTools();
      const info = client.getServerVersion();

      const tools: McpToolDescriptor[] = listed.tools
        .filter((tool) => !config.disabledTools.includes(tool.name))
        .map((tool) => ({
          serverId: config.id,
          name: tool.name,
          description: tool.description ?? 'No description supplied by the server.',
          inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
          risk: riskForMcpTool(tool.name, config.autonomy),
        }));

      return {
        serverId: config.id,
        status: 'connected' as const,
        tools,
        ...(info?.name ? { serverName: info.name } : {}),
        ...(info?.version ? { serverVersion: String(info.version) } : {}),
        checkedAt,
        latencyMs: Date.now() - started,
      };
    });
  } catch (error) {
    return {
      serverId: config.id,
      status: 'error',
      tools: [],
      error: describeError(error),
      checkedAt,
      latencyMs: Date.now() - started,
    };
  }
}

export interface McpCallResult {
  readonly ok: boolean;
  readonly text: string;
  readonly isError: boolean;
  readonly durationMs: number;
}

/**
 * Call one tool on one server.
 *
 * The caller is responsible for having checked the approval gate first — this
 * function performs the call unconditionally, because a single function that
 * both decides and acts is a function where the decision can be skipped.
 */
export async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): Promise<McpCallResult> {
  const started = Date.now();

  if (!config.enabled) {
    return { ok: false, text: `${config.name} is disabled.`, isError: true, durationMs: 0 };
  }
  if (config.disabledTools.includes(toolName)) {
    return {
      ok: false,
      text: `"${toolName}" is switched off for ${config.name}.`,
      isError: true,
      durationMs: 0,
    };
  }

  try {
    return await withClient(config, CALL_TIMEOUT_MS, async (client) => {
      const result = await client.callTool({ name: toolName, arguments: { ...args } });

      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((block) => {
          const entry = block as { type?: string; text?: string };
          if (entry.type === 'text' && typeof entry.text === 'string') return entry.text;
          return `[${entry.type ?? 'unknown'} content]`;
        })
        .join('\n')
        .trim();

      const isError = result.isError === true;
      // Verbatim, including empty. Substituting a cheerful "Done." for a server
      // that returned nothing invents a result the server never gave, and makes
      // "the tool returned nothing" indistinguishable from "the tool succeeded
      // and said so". The UI renders the absence.
      return { ok: !isError, text, isError, durationMs: Date.now() - started };
    });
  } catch (error) {
    return {
      ok: false,
      text: describeError(error),
      isError: true,
      durationMs: Date.now() - started,
    };
  }
}
