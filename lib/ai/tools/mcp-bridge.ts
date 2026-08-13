/**
 * Remote tools, expressed as local ones.
 *
 * A tool advertised by an MCP server becomes a `ToolDefinition` identical in
 * shape to a built-in. That is the whole point: the approval gate, the argument
 * validation, the secret-smuggling check and the preview requirement are written
 * once, against `ToolDefinition`, and a remote tool cannot opt out of any of them
 * by being remote.
 *
 * Client-safe, like the rest of the registry — this file is pure functions over
 * data the server already probed, so the command palette and the approval sheet
 * can describe a remote call without being able to make one.
 */

import type {
  McpServerConfig,
  McpToolDescriptor,
  ParamType,
  ToolArgs,
  ToolDefinition,
  ToolParam,
} from '@/lib/domain';
import { mcpToolId, riskForMcpTool } from '@/lib/domain';

interface JsonSchemaProperty {
  readonly type?: string | string[];
  readonly description?: string;
  readonly enum?: unknown[];
  readonly default?: unknown;
}

function firstType(type: string | string[] | undefined): string {
  if (Array.isArray(type)) return type.find((entry) => entry !== 'null') ?? 'string';
  return type ?? 'string';
}

function paramType(property: JsonSchemaProperty): ParamType {
  if (Array.isArray(property.enum) && property.enum.length > 0) return 'enum';
  switch (firstType(property.type)) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
    case 'object':
      // Carried as JSON text and parsed in the executor. A structured argument is
      // still an argument the founder has to be able to read before approving it.
      return 'text';
    default:
      return 'string';
  }
}

/**
 * Derive parameters from the server's declared JSON Schema.
 *
 * Servers vary enormously in how carefully they write these, so this is
 * deliberately forgiving: an unreadable schema yields no parameters rather than
 * an exception, and the tool still appears — it just cannot be called with
 * arguments until the server describes them.
 */
export function paramsFromSchema(schema: Readonly<Record<string, unknown>>): ToolParam[] {
  const properties = schema['properties'];
  if (!properties || typeof properties !== 'object') return [];

  const requiredRaw = schema['required'];
  const required = new Set(
    Array.isArray(requiredRaw) ? requiredRaw.filter((entry): entry is string => typeof entry === 'string') : [],
  );

  const params: ToolParam[] = [];
  for (const [name, raw] of Object.entries(properties as Record<string, unknown>)) {
    const property = (raw && typeof raw === 'object' ? raw : {}) as JsonSchemaProperty;
    const type = paramType(property);
    const enumValues =
      type === 'enum' ? (property.enum ?? []).map((entry) => String(entry)) : undefined;

    params.push({
      name,
      type,
      description: property.description?.trim() || `${name}, as declared by the server.`,
      required: required.has(name),
      ...(enumValues ? { enumValues } : {}),
      ...(property.default === undefined || typeof property.default === 'object'
        ? {}
        : { default: property.default as string | number | boolean }),
      // A remote call is exactly where a credential legitimately travels outward.
      // The placeholder is what gets persisted on the ToolCall; the executor
      // resolves it at the moment of the call and the outcome is scrubbed.
      ...(type === 'string' || type === 'text' ? { acceptsSecret: true } : {}),
    });
  }
  return params;
}

function humanise(toolName: string): string {
  return toolName
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

function describeArgs(args: ToolArgs): string {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== '');
  if (entries.length === 0) return 'no arguments';
  return entries
    .map(([key, value]) => {
      const text = String(value);
      return `${key}: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`;
    })
    .join(', ');
}

/**
 * One remote tool as a local definition.
 *
 * The preview names the server as well as the tool, because "publish post" means
 * something very different depending on which account is on the other end, and a
 * founder approving it is entitled to know which one before they say yes.
 */
export function mcpToolDefinition(
  server: McpServerConfig,
  descriptor: McpToolDescriptor,
): ToolDefinition {
  const id = mcpToolId(server.id, descriptor.name);
  const readable = humanise(descriptor.name);

  return {
    id,
    label: `${readable} · ${server.name}`,
    description: `${descriptor.description} Runs on the ${server.name} connection.`,
    // Tier from the server's *live* autonomy, not the value frozen into the
    // descriptor at probe time. A founder who tightens a connection from
    // 'trusted' to 'ask-always' must have that take effect on the next call —
    // trusting the probe snapshot kept the looser tier until a manual re-probe,
    // so a tightened server went on running external calls unattended.
    risk: riskForMcpTool(descriptor.name, server.autonomy),
    capabilityId: server.capabilityId,
    // A connection belongs to the founder, so its tools are offered in every
    // space they work in. Which scope a call is *recorded* against is still
    // decided by the caller, and its result is written there and nowhere else.
    scopeKinds: ['company', 'personal'],
    params: paramsFromSchema(descriptor.inputSchema),
    matches: [readable, descriptor.name, server.name.toLowerCase()],
    preview: (args) =>
      `Call “${descriptor.name}” on ${server.name} with ${describeArgs(args)}. This runs outside OmniOS.`,
  };
}

/** Every tool from every enabled server, ready to be merged with the built-ins. */
export function mcpToolDefinitions(
  servers: readonly McpServerConfig[],
  states: readonly { serverId: string; tools: readonly McpToolDescriptor[] }[],
): ToolDefinition[] {
  const byId = new Map(servers.map((server) => [server.id, server]));
  const definitions: ToolDefinition[] = [];

  for (const state of states) {
    const server = byId.get(state.serverId);
    if (!server || !server.enabled) continue;
    for (const descriptor of state.tools) {
      // The probe snapshot can predate a founder switching a tool off, so the
      // config is checked again here rather than trusted from the cache.
      if (server.disabledTools.includes(descriptor.name)) continue;
      definitions.push(mcpToolDefinition(server, descriptor));
    }
  }
  return definitions;
}
