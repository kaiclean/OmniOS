import 'server-only';

/**
 * Everything this scope can actually call — built-in and connected.
 *
 * The bridge that turns a probed MCP server into `ToolDefinition`s has existed
 * since connections shipped, but only `resolveTool` ever consulted it, at the
 * moment of execution. The *planner* read `toolsForScope`, which knows the
 * static registry and nothing else.
 *
 * The effect was a system that could execute a remote tool it could never
 * decide to use. Asked to read a file with a filesystem server connected and
 * fourteen of its tools tiered and ready, the assistant searched its own
 * records five times and concluded it had no way — because from where it was
 * standing, it did not. Connecting a server changed what OmniOS could do and
 * not what it knew it could do.
 */

import type { Scope, ToolDefinition } from '@/lib/domain';
import { getWorkspace } from '@/lib/data/store';
import { mcpToolDefinitions } from './tools/mcp-bridge';
import { toolsForScope } from './tools';

export async function availableTools(scope: Scope): Promise<ToolDefinition[]> {
  const builtIn = toolsForScope(scope);
  if (scope.kind === 'shared') return builtIn;

  const workspace = await getWorkspace();
  // `mcpToolDefinitions` re-checks `enabled` and `disabledTools` against live
  // config rather than trusting the probe snapshot, so a server switched off
  // since its last probe contributes nothing here.
  return [...builtIn, ...mcpToolDefinitions(workspace.mcpServers, workspace.mcpStates)];
}

/**
 * The tools one operator may reach — a subset, never a superset.
 *
 * Hiring an agent already declared `capabilityIds` and `toolIds`, the Team page
 * showed them, and nothing read either. So a Podcast Producer hired into a
 * construction company could file a finance entry or delete a record, and the
 * charter the founder chose was decoration.
 *
 * The rule is subtractive by construction: this filters `availableTools(scope)`
 * and can only ever remove. An agent cannot reach a tool the space does not
 * have, cannot reach a connection the founder has not made, and cannot escape
 * the gate — a `destructive` or `external` call it plans still stops and waits,
 * exactly as one the founder typed would.
 *
 * Read tools are exempt. Looking something up changes nothing, and an operator
 * that cannot check its own space before speaking is one that guesses — which
 * is the failure the charter exists to prevent, not the one it causes.
 */
export function toolsForAgent(
  tools: readonly ToolDefinition[],
  agent: { readonly toolIds?: readonly string[]; readonly capabilityIds?: readonly string[] },
): ToolDefinition[] {
  const declared = new Set(agent.toolIds ?? []);
  const capabilities = new Set(agent.capabilityIds ?? []);

  // An agent that declares neither is unrestricted, which is what a built-in
  // specialist has always been. Silently granting nothing would be worse: it
  // would look like the agent was broken rather than deliberately narrow.
  if (declared.size === 0 && capabilities.size === 0) return [...tools];

  return tools.filter((tool) => {
    if (tool.risk === 'read') return true;
    if (declared.has(tool.id)) return true;
    // A connection tool belongs to no capability, so a capability-only charter
    // does not reach it. Naming it in `toolIds` is the way to grant one.
    if (declared.size > 0) return false;
    return capabilities.has(tool.capabilityId);
  });
}
