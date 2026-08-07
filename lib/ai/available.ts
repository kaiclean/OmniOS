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
