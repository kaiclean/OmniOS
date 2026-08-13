/**
 * MCP connections — how OmniOS reaches the outside world.
 *
 * Everything the founder wants the assistant to do beyond this workspace —
 * browse, deploy a site, generate video, post to a social account, move money —
 * arrives the same way: as an MCP server they connect. That is deliberate. It
 * means OmniOS does not accumulate a dozen bespoke integrations with a dozen
 * different auth stories and a dozen different blast radii. There is one door,
 * and it has one lock.
 *
 * The lock is the tool layer. An MCP tool is bridged into a `ToolDefinition` at
 * runtime and therefore inherits the approval gate for free: by default every
 * remote call is `external` risk, which means it stops and waits for a recorded
 * human decision. A founder can lower that per server, deliberately, and the
 * setting is visible wherever the server appears.
 *
 * Two things worth being blunt about, because they shape the design:
 *
 * - A stdio server is a local process this app spawns. That is arbitrary code
 *   execution on the founder's machine. It only ever happens from a config the
 *   founder created by hand, and the UI says so plainly.
 * - Credentials never live in this config. They live in the vault, and appear
 *   here only as `{{secret:NAME}}` placeholders, resolved at connection time.
 */

import type { RiskTier } from './tools';
import type { Timestamp } from './work';

export const MCP_TRANSPORTS = ['stdio', 'http'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * How much a server is trusted.
 *
 * `ask-always` is the default and the safe one. `trusted` is real autonomy and
 * is why this is a per-server decision rather than a global switch: a founder
 * may reasonably let a read-only search server run unattended while requiring
 * approval for anything that posts under their name.
 */
export const MCP_AUTONOMY = ['ask-always', 'ask-writes', 'trusted'] as const;
export type McpAutonomy = (typeof MCP_AUTONOMY)[number];

export const MCP_AUTONOMY_EXPLANATION: Record<McpAutonomy, string> = {
  'ask-always': 'Every call from this server waits for your approval. The safe default.',
  'ask-writes':
    'Read-only calls run on their own. Anything that changes something outside OmniOS waits for you.',
  trusted:
    'Calls run without asking. Only for a server you control and whose blast radius you have thought about.',
};

export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly transport: McpTransport;
  /** stdio: the executable and its arguments. */
  readonly command?: string;
  readonly args?: readonly string[];
  /** stdio: environment for the child process. Values may be {{secret:NAME}}. */
  readonly env?: Readonly<Record<string, string>>;
  /** http: the endpoint. */
  readonly url?: string;
  /** http: headers. Values may be {{secret:NAME}}. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  readonly autonomy: McpAutonomy;
  /** Capability this server's tools are filed under, for routing and the UI. */
  readonly capabilityId: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly lastConnectedAt?: Timestamp;
  readonly lastError?: string;
  /** Tool names the founder has explicitly disabled on this server. */
  readonly disabledTools: readonly string[];
}

/** One tool a connected server advertises. */
export interface McpToolDescriptor {
  readonly serverId: string;
  readonly name: string;
  readonly description: string;
  /** The server's declared JSON Schema for arguments, as given. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Derived from the server's autonomy plus the tool's own shape. */
  readonly risk: RiskTier;
}

export const MCP_STATUSES = ['connected', 'error', 'disabled', 'never-connected'] as const;
export type McpStatus = (typeof MCP_STATUSES)[number];

export interface McpConnectionState {
  readonly serverId: string;
  readonly status: McpStatus;
  readonly tools: readonly McpToolDescriptor[];
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly error?: string;
  readonly checkedAt: Timestamp;
  readonly latencyMs?: number;
}

/**
 * The risk tier a remote tool gets.
 *
 * Read-only names are recognised — but only as *whole words*, and only when no
 * mutating word is also present. Substring matching once read `checkout_cart`
 * as read-only because it starts with `check`, and on an `ask-writes` server
 * that ran a purchase with no recorded decision. The fallback is always
 * `external`: an unrecognised tool from a third-party server is assumed able to
 * do something consequential, because it can.
 */
const READ_ONLY_HINTS = new Set([
  'list',
  'get',
  'read',
  'search',
  'find',
  'fetch',
  'query',
  'describe',
  'status',
  'check',
  'view',
  'inspect',
]);

/**
 * Words that mean a call changes something. If any appears, the tool is never
 * treated as read-only however read-ish the rest of the name looks — `get_or_
 * create_customer` and `fetch_and_store` both mutate.
 */
const MUTATING_HINTS = new Set([
  'create',
  'update',
  'delete',
  'remove',
  'write',
  'set',
  'add',
  'post',
  'put',
  'patch',
  'send',
  'publish',
  'checkout',
  'buy',
  'pay',
  'purchase',
  'order',
  'charge',
  'store',
  'save',
  'upload',
  'execute',
  'run',
  'trigger',
  'cancel',
  'approve',
  'move',
  'copy',
  'share',
  'invite',
  'merge',
  'deploy',
  'install',
]);

/** Split a tool name into lowercase word tokens: snake, kebab and camelCase. */
export function toolNameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

export function riskForMcpTool(name: string, autonomy: McpAutonomy): RiskTier {
  if (autonomy === 'trusted') return 'write';

  const tokens = toolNameTokens(name);
  const mutates = tokens.some((token) => MUTATING_HINTS.has(token));
  const looksReadOnly = !mutates && tokens.some((token) => READ_ONLY_HINTS.has(token));

  if (autonomy === 'ask-writes' && looksReadOnly) return 'read';
  return 'external';
}

/** Namespaced so a remote tool can never collide with a built-in one. */
export function mcpToolId(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function parseMcpToolId(id: string): { serverId: string; toolName: string } | null {
  if (!id.startsWith('mcp:')) return null;
  const rest = id.slice(4);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  const serverId = rest.slice(0, separator);
  const toolName = rest.slice(separator + 1);
  return toolName ? { serverId, toolName } : null;
}

export function isValidServerId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(id);
}

/**
 * Presets for servers a founder is likely to want.
 *
 * These are configuration starting points, not endorsements or bundled code:
 * each still requires the founder to install the server and supply their own
 * credentials. Nothing here connects on its own.
 */
export interface McpPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly transport: McpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly envKeys?: readonly string[];
  readonly url?: string;
  readonly capabilityId: string;
  readonly suggestedAutonomy: McpAutonomy;
  readonly unlocks: string;
}

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files in a directory you nominate.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<ABSOLUTE_PATH>'],
    capabilityId: 'operations',
    suggestedAutonomy: 'ask-writes',
    unlocks: 'Drafting documents and reading project files on your own machine.',
  },
  {
    id: 'fetch',
    name: 'Web fetch',
    // `@modelcontextprotocol/server-fetch` does not exist and never did — the
    // registry returns 404. This preset was unusable from the day it shipped,
    // and it is the one most often recommended as the easy first connection,
    // so the failure landed on exactly the founder least equipped to diagnose
    // it. The real server is Python, published to PyPI, and run through uv.
    description: 'Retrieve a URL and return its content as text. Needs uv installed (brew install uv).',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    capabilityId: 'research',
    suggestedAutonomy: 'ask-writes',
    unlocks: 'Reading the open web — competitor pages, documentation, sources for research.',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, issues and pull requests.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    capabilityId: 'development',
    suggestedAutonomy: 'ask-always',
    unlocks: 'Shipping code changes and tracking work in the Development capability.',
  },
  {
    id: 'puppeteer',
    name: 'Browser',
    description: 'Drive a real browser: navigate, screenshot, fill forms.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    capabilityId: 'research',
    suggestedAutonomy: 'ask-always',
    unlocks: 'Anything that needs a real page rather than an API — including sites with no API.',
  },
  {
    id: 'postgres',
    name: 'Postgres',
    description: 'Query a Postgres database.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '<CONNECTION_STRING>'],
    capabilityId: 'development',
    suggestedAutonomy: 'ask-writes',
    unlocks: 'Reading production data into the Finance and Development capabilities.',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and post in channels you have access to.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    capabilityId: 'operations',
    suggestedAutonomy: 'ask-always',
    unlocks: 'Posting updates where your team already is.',
  },
  {
    id: 'custom-http',
    name: 'Custom HTTP server',
    description: 'Any MCP server reachable over HTTP.',
    transport: 'http',
    url: 'https://example.com/mcp',
    capabilityId: 'operations',
    suggestedAutonomy: 'ask-always',
    unlocks: 'Your own services, or a hosted provider that speaks MCP.',
  },
];
