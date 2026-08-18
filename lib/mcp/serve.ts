/**
 * The OmniOS MCP server — this workspace, readable by outside agent harnesses.
 *
 * DeepSeek Harness (and anything else speaking MCP) connects to this over
 * stdio and can ground its work on real workspace records instead of guessing.
 * The launcher is ops/dsh/omnios-mcp-server.sh, which runs this file through
 * tsx with the `react-server` condition so the store facade's `server-only`
 * import resolves to nothing outside Next.
 *
 * Two rules shape every tool here, and they are the in-process rules restated
 * at the wire:
 *
 * - **Reads only.** There is no mutating tool and there must never be one. A
 *   change that originates in an outside harness comes back through the OmniOS
 *   assistant and the approval gate, not through a side door that no gate ever
 *   sees.
 * - **Every read names a scope.** Each tool takes an explicit scope key and
 *   refuses without one. This module goes through the store facade like
 *   everything else — no aggregate view exists on this boundary, so a harness
 *   task launched for one company can be handed exactly that company and
 *   nothing else.
 *
 * The tool handlers are exported separately from the transport so the logic is
 * testable in vitest without spawning a process.
 */

import { pathToFileURL } from 'node:url';

import { COLLECTION_NAMES, type CollectionName } from '@/lib/data/schema';
import { getWorkspace, readScope } from '@/lib/data/store';
import { parseScopeKey } from '@/lib/domain';

export interface OmniosMcpResult {
  readonly text: string;
  readonly isError: boolean;
}

const ok = (text: string): OmniosMcpResult => ({ text, isError: false });
const refuse = (text: string): OmniosMcpResult => ({ text, isError: true });

const SCOPE_HELP =
  'Pass "scope" as one of: personal, company:<companyId>, shared:<capabilityId>. ' +
  'Use list_spaces to discover company ids.';

export const OMNIOS_MCP_TOOLS = [
  {
    name: 'list_spaces',
    description:
      'List the spaces in this OmniOS workspace: the personal space and each company, ids and names only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_scope_summary',
    description: `Record counts per collection for one scope. ${SCOPE_HELP}`,
    inputSchema: {
      type: 'object',
      properties: { scope: { type: 'string', description: 'The scope key to summarise.' } },
      required: ['scope'],
    },
  },
  {
    name: 'list_records',
    description: `Read records from one collection in one scope. ${SCOPE_HELP}`,
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'The scope key to read from.' },
        collection: {
          type: 'string',
          description: `One of: ${COLLECTION_NAMES.join(', ')}.`,
        },
        limit: { type: 'number', description: 'At most this many records (default 20, max 100).' },
      },
      required: ['scope', 'collection'],
    },
  },
] as const;

function requireScope(args: Readonly<Record<string, unknown>>) {
  const raw = typeof args.scope === 'string' ? args.scope.trim() : '';
  if (!raw) return { scope: null, error: refuse(`A scope is required. ${SCOPE_HELP}`) };
  const scope = parseScopeKey(raw);
  if (!scope) return { scope: null, error: refuse(`"${raw}" is not a scope key. ${SCOPE_HELP}`) };
  return { scope, error: null };
}

export async function handleOmniosTool(
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<OmniosMcpResult> {
  if (name === 'list_spaces') {
    const root = await getWorkspace();
    const spaces = [
      { scope: 'personal', name: 'Personal life' },
      ...root.companies.map((company) => ({
        scope: `company:${company.id}`,
        name: company.name,
      })),
    ];
    return ok(JSON.stringify(spaces, null, 2));
  }

  if (name === 'get_scope_summary') {
    const { scope, error } = requireScope(args);
    if (!scope) return error;
    const data = await readScope(scope);
    const counts = Object.fromEntries(
      COLLECTION_NAMES.map((collection) => [collection, data[collection].length]),
    );
    return ok(JSON.stringify(counts, null, 2));
  }

  if (name === 'list_records') {
    const { scope, error } = requireScope(args);
    if (!scope) return error;
    const collection = typeof args.collection === 'string' ? args.collection : '';
    if (!(COLLECTION_NAMES as readonly string[]).includes(collection)) {
      return refuse(`"${collection}" is not a collection. One of: ${COLLECTION_NAMES.join(', ')}.`);
    }
    const rawLimit = typeof args.limit === 'number' ? Math.floor(args.limit) : 20;
    const limit = Math.min(Math.max(rawLimit, 1), 100);
    const data = await readScope(scope);
    const records = data[collection as CollectionName].slice(0, limit);
    return ok(JSON.stringify(records, null, 2));
  }

  return refuse(`Unknown tool "${name}".`);
}

async function main(): Promise<void> {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import(
    '@modelcontextprotocol/sdk/types.js'
  );

  const server = new Server(
    { name: 'omnios', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: OMNIOS_MCP_TOOLS.map((tool) => ({ ...tool })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await handleOmniosTool(req.params.name, req.params.arguments ?? {});
    return {
      content: [{ type: 'text', text: result.text }],
      ...(result.isError ? { isError: true } : {}),
    };
  });
  await server.connect(new StdioServerTransport());
}

// Start the transport only when executed directly — importing this module (the
// tests do) must never claim stdio.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
