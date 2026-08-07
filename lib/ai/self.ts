/**
 * What the assistant knows about itself.
 *
 * Written after reading a real conversation in which the founder asked whether
 * OmniOS could run an Instagram agent, and the assistant replied: *"I genuinely
 * don't know what's available to you… you may want to check with whoever manages
 * your OmniOS setup."* There is nobody else. It is the only thing that knows,
 * and it had never been told.
 *
 * That was not a model failure. Nothing in the system prompt, and nothing in
 * `compose.ts`, ever mentioned that tools exist — so the assistant was reasoning
 * about its own abilities from priors about assistants in general. Given that, an
 * honest refusal to guess was the best available answer, and it was still wrong.
 *
 * Derived from the registry and the workspace rather than written down, so it
 * cannot drift: a tool added tomorrow appears here, and a connection that is
 * configured but has never connected is described as exactly that.
 */

import type { McpConnectionState, McpServerConfig, ToolDefinition } from '@/lib/domain';
import { getCapability } from '@/lib/capabilities/registry';

export interface SelfKnowledgeInput {
  readonly tools: readonly ToolDefinition[];
  readonly servers: readonly McpServerConfig[];
  readonly states: readonly McpConnectionState[];
  /** Tools whose executor refuses by design, so they are never claimed as possible. */
  readonly unwiredToolIds: readonly string[];
}

function byCapability(tools: readonly ToolDefinition[]): string[] {
  const groups = new Map<string, string[]>();
  for (const tool of tools) {
    const name = getCapability(tool.capabilityId)?.name ?? tool.capabilityId;
    const list = groups.get(name) ?? [];
    list.push(tool.label.toLowerCase());
    groups.set(name, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, labels]) => `  ${name}: ${labels.sort().join(', ')}`);
}

/**
 * A compact, true account of what this assistant can do right now.
 *
 * Compact matters: this rides on every turn, so it is a summary rather than the
 * catalogue. The detail lives in the tool schemas the planner already receives —
 * this exists so the *answering* half stops being ignorant of the acting half.
 */
export function describeSelf(input: SelfKnowledgeInput): string {
  const usable = input.tools.filter((tool) => !input.unwiredToolIds.includes(tool.id));
  const reads = usable.filter((tool) => tool.risk === 'read');
  const writes = usable.filter((tool) => tool.risk === 'write');
  const gated = usable.filter((tool) => tool.risk === 'destructive' || tool.risk === 'external');
  const remote = usable.filter((tool) => tool.id.startsWith('mcp:'));

  const connected = input.states.filter((state) => state.status === 'connected');
  const configured = input.servers.filter((server) => server.enabled);

  const lines: string[] = [
    'WHAT YOU CAN ACTUALLY DO. This list is generated from your own tool registry, so it is complete and current. Answer questions about your abilities from it, and from nothing else.',
    '',
    `You can read this space: ${reads.length > 0 ? reads.map((t) => t.label.toLowerCase()).join(', ') : 'nothing — you have no read tools, so you can only use records already in front of you'}.`,
    '',
    'You can create and change these records, and doing so happens immediately:',
    ...byCapability(writes),
  ];

  if (gated.length > 0) {
    lines.push(
      '',
      `These stop and wait for the founder to approve them, every time: ${gated.map((t) => t.label.toLowerCase()).join(', ')}.`,
    );
  }

  lines.push('', 'Reaching outside OmniOS:');
  if (input.unwiredToolIds.length > 0) {
    lines.push(
      `  ${input.unwiredToolIds.join(', ')} exist but are not wired to any provider — they refuse rather than send. Do not offer them as things you can do.`,
    );
  }
  if (configured.length === 0) {
    lines.push(
      '  No connections are configured, so you cannot browse the web, read email, post to social media, touch a repository or call any third-party service.',
      '  This is not a permissions problem and there is no other section to look in — you are the only thing that knows this. If the founder asks for something outward, say plainly that it needs a connection, and that connections are added on the Connections page.',
    );
  } else {
    lines.push(
      `  ${configured.length} connection(s) configured, ${connected.length} currently reachable: ${connected.map((s) => s.serverId).join(', ') || 'none'}.`,
      `  That gives you ${remote.length} remote tool(s). Anything not on that list, you cannot do.`,
    );
  }

  lines.push(
    '',
    'Never tell the founder to ask someone else what you are capable of, and never suggest there may be a section you cannot see. There is nobody else and there is no such section.',
  );

  return lines.join('\n');
}
