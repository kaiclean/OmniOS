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

import type { PermissionGrant, Scope, ToolCall } from '@/lib/domain';
import {
  grantCovers,
  makeRecordId,
  parseMcpToolId,
  requiresApproval,
  scopeKey,
  validateArgs,
} from '@/lib/domain';
import { getWorkspace, insertRecords } from '@/lib/data/store';
import { resolveSecrets } from '@/lib/secrets/vault';
import { resolveTool, runTool } from './executors';
import { notifyPendingCall } from '@/lib/telegram/approvals';

export interface ProposeOutcome {
  readonly ok: boolean;
  readonly awaitingApproval: boolean;
  readonly toolCallId: string;
  readonly summary: string;
  /** Records the call created or changed — how a caller links to what it made. */
  readonly affectedIds?: readonly string[];
  /** The preview persisted on the call — what an approval decides about. */
  readonly preview: string;
  readonly toolLabel: string;
  readonly risk: string;
}

export async function proposeCore(
  scope: Scope,
  toolId: string,
  raw: Readonly<Record<string, unknown>>,
  options: {
    readonly runId?: string;
    readonly now?: Date;
    /**
     * Which step of a multi-step turn this is.
     *
     * A ToolCall id is derived from scope, tool, timestamp and arguments so it
     * stays deterministic. The acting loop freezes `now` for a whole turn — it
     * must, or a generator would read the clock — so a model that plans the
     * *same* call twice across two rounds produced two records with the same id,
     * and `insertRecords` prepended the duplicate. It surfaced as React refusing
     * to render the approvals list: "two children with the same key".
     */
    readonly sequence?: number;
  } = {},
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

  const id = makeRecordId(
    'call',
    `${scopeKey(scope)}:${toolId}:${at}:${options.sequence ?? 0}:${JSON.stringify(validation.coerced)}`,
  );
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

  // A standing grant is a per-call decision made in advance — and only for
  // tools that arrive through a connection. Built-in destructive tools cannot
  // be granted: parseMcpToolId refuses them here by construction, so deleting
  // records or resetting a capability stays a fresh human decision forever.
  const remote = parseMcpToolId(toolId);
  const grant =
    gated && remote
      ? workspace.grants.find((candidate: PermissionGrant) =>
          grantCovers(
            candidate,
            { serverId: remote.serverId, toolName: remote.toolName, scopeKey: scopeKey(scope) },
            now,
          ),
        )
      : undefined;

  if (gated && grant) {
    const outcome = await runTool(
      toolId,
      { scope, now, actor: 'founder', resolveSecrets },
      validation.coerced,
      // The decision the gate requires is the grant itself: who decided is the
      // founder, when is the moment they granted it, and the call names it.
      { approval: { decidedBy: 'founder', decidedAt: grant.createdAt } },
    );
    const call: ToolCall = {
      ...base,
      status: outcome.ok ? 'executed' : 'failed',
      result: outcome.summary,
      affectedIds: outcome.affectedIds ?? [],
      decidedBy: 'founder',
      decidedAt: grant.createdAt,
      grantId: grant.id,
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    await insertRecords(scope, 'toolCalls', [call]);
    return {
      ok: outcome.ok,
      awaitingApproval: false,
      toolCallId: id,
      summary: `${outcome.summary} — ran under your standing grant (“${grant.note}”).`,
      ...(outcome.affectedIds ? { affectedIds: outcome.affectedIds } : {}),
      preview,
      toolLabel: tool.label,
      risk: tool.risk,
    };
  }

  if (gated) {
    const call: ToolCall = { ...base, status: 'awaiting-approval' };
    await insertRecords(scope, 'toolCalls', [call]);
    // Second door onto the same inbox, after the record is written. Awaited,
    // but bounded and soft: the client times out at five seconds and never
    // throws, so a Telegram outage delays a queued call by seconds at most and
    // can never stop it — the approvals page is the source of truth.
    await notifyPendingCall(call, spaceLabelFor(scope, workspace));
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
    ...(outcome.affectedIds ? { affectedIds: outcome.affectedIds } : {}),
    preview,
    toolLabel: tool.label,
    risk: tool.risk,
  };
}

/** The founder's own name for the space, for a message that arrives out of context. */
function spaceLabelFor(scope: Scope, workspace: { companies: ReadonlyArray<{ id: string; name: string }>; personal: { displayName: string } }): string {
  if (scope.kind === 'company') {
    return workspace.companies.find((company) => company.id === scope.companyId)?.name ?? scope.companyId;
  }
  return workspace.personal.displayName;
}
