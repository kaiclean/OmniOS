import 'server-only';

/**
 * The propose core — persist first, gate always, then maybe run.
 *
 * Extracted from `lib/actions/tools.ts` so the assistant can propose calls
 * without `lib/ai` importing a Server Action module. The contract is unchanged
 * and is the load-bearing half of invariant 2: the ToolCall is written with its
 * preview *before* anything executes, an autonomous tier runs immediately, and
 * a gated tier stops at `awaiting-approval` — recorded, visible, and unrun.
 * `lib/actions/tools.ts` remains the only place a human decision is recorded.
 */

import type { Scope, ToolCall } from '@/lib/domain';
import { makeRecordId, requiresApproval, scopeKey, validateArgs } from '@/lib/domain';
import { getWorkspace, insertRecords } from '@/lib/data/store';
import { resolveSecrets } from '@/lib/secrets/vault';
import { resolveTool, runTool } from './executors';

export interface ProposeOutcome {
  readonly ok: boolean;
  readonly awaitingApproval: boolean;
  readonly toolCallId: string;
  readonly summary: string;
  /** The preview persisted on the call — what an approval decides about. */
  readonly preview: string;
  readonly toolLabel: string;
  readonly risk: string;
}

export async function proposeCore(
  scope: Scope,
  toolId: string,
  raw: Readonly<Record<string, unknown>>,
  options: { readonly runId?: string; readonly now?: Date } = {},
): Promise<ProposeOutcome> {
  const now = options.now ?? new Date();
  const at = now.toISOString();

  const tool = await resolveTool(toolId);
  if (!tool) {
    return {
      ok: false,
      awaitingApproval: false,
      toolCallId: '',
      summary: `No tool called “${toolId}” is available here.`,
      preview: '',
      toolLabel: toolId,
      risk: 'unknown',
    };
  }

  const validation = validateArgs(tool, raw);
  const workspace = await getWorkspace();
  const gated = requiresApproval(tool.risk, { confirmWrites: workspace.settings.confirmWrites });

  const id = makeRecordId('call', `${scopeKey(scope)}:${toolId}:${at}:${JSON.stringify(validation.coerced)}`);
  const preview = tool.preview(validation.coerced);
  const base = {
    id,
    scope,
    createdAt: at,
    updatedAt: at,
    toolId,
    args: validation.coerced,
    risk: tool.risk,
    preview,
    affectedIds: [] as string[],
    at,
    ...(options.runId ? { runId: options.runId } : {}),
  };

  if (!validation.ok) {
    const call: ToolCall = { ...base, status: 'failed', error: validation.errors.join('; ') };
    await insertRecords(scope, 'toolCalls', [call]);
    return {
      ok: false,
      awaitingApproval: false,
      toolCallId: id,
      summary: call.error ?? 'Invalid arguments.',
      preview,
      toolLabel: tool.label,
      risk: tool.risk,
    };
  }

  if (gated) {
    const call: ToolCall = { ...base, status: 'awaiting-approval' };
    await insertRecords(scope, 'toolCalls', [call]);
    return {
      ok: true,
      awaitingApproval: true,
      toolCallId: id,
      summary: preview,
      preview,
      toolLabel: tool.label,
      risk: tool.risk,
    };
  }

  const outcome = await runTool(toolId, { scope, now, actor: 'founder', resolveSecrets }, validation.coerced);
  const call: ToolCall = {
    ...base,
    status: outcome.ok ? 'executed' : 'failed',
    result: outcome.summary,
    affectedIds: outcome.affectedIds ?? [],
    ...(outcome.error ? { error: outcome.error } : {}),
  };
  await insertRecords(scope, 'toolCalls', [call]);
  return {
    ok: outcome.ok,
    awaitingApproval: false,
    toolCallId: id,
    summary: outcome.summary,
    preview,
    toolLabel: tool.label,
    risk: tool.risk,
  };
}
