/**
 * A minimal but genuine MCP server, used by tests/mcp.test.ts.
 *
 * It lives inside the repo rather than in a temp directory so that it resolves
 * @modelcontextprotocol/sdk from node_modules — a server that cannot import its
 * own SDK exits immediately, and the client sees only "Connection closed", which
 * is a confusing way to discover a path problem.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'test-server', version: '1.2.3' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'search_web', description: 'Search the web.', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
    { name: 'publish_post', description: 'Publish a post.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    { name: 'echo_env', description: 'Echo an environment variable.', inputSchema: { type: 'object', properties: { key: { type: 'string' } } } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  if (name === 'search_web') return { content: [{ type: 'text', text: 'results for: ' + args.q }] };
  if (name === 'publish_post') return { content: [{ type: 'text', text: 'refused' }], isError: true };
  if (name === 'echo_env') return { content: [{ type: 'text', text: String(process.env[String(args.key)] ?? '') }] };
  return { content: [{ type: 'text', text: 'unknown' }], isError: true };
});

await server.connect(new StdioServerTransport());
