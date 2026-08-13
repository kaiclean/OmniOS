'use server';

import { revalidatePath } from 'next/cache';

import type { Scope, ToolCall, ToolOutcome } from '@/lib/domain';
import { companyScope, isDecidedCall, makeRecordId, personalScope, requiresApproval, scopeKey, validateArgs } from '@/lib/domain';
import { getWorkspace, insertRecords, readCollection, updateRecord } from '@/lib/data/store';
import { resolveTool } from '@/lib/ai/tools/executors';
import { LOCAL_DECIDER, approveToolCallAs, rejectToolCallAs } from '@/lib/approvals/decide';
import { proposeCore } from '@/lib/ai/tools/propose';
import { resolveSecrets } from '@/lib/secrets/vault';

/**
 * Proposing, approving and rejecting a tool call.
 *
 * This is the other half of the gate. `runTool` refuses a gated tier without a
 * recorded decision; these actions are where that decision gets recorded, and
 * where a refused call becomes a durable thing a founder can come back to rather
 * than an error that vanished.
 *
 * The order matters and is the whole safety property:
 *
 * 1. `proposeToolCall` persists the call with its preview, computed *before*
 *    anything runs. An autonomous tier runs immediately; a gated one is stored
 *    as `awaiting-approval` and stops there.
 * 2. `approveToolCall` writes who decided and when, and only then calls
 *    `runTool` with that decision. There is no path that runs a gated call
 *    without first having written the approval down.
 *
 * The persisted args keep any `{{secret:NAME}}` placeholder exactly as written.
 * Resolution happens inside the executor, so an approval request can be read
 * safely and the record left behind never contains a credential.
 */

export interface ProposeResult {
  readonly ok: boolean;
  /** True when the call was stored and is waiting rather than done. */
  readonly awaitingApproval: boolean;
  readonly toolCallId: string;
  readonly summary: string;
}

/**
 * Put a call on the record, then run it only if its tier allows.
 *
 * Every call OmniOS makes goes through here, which is what makes the ToolCall
 * collection a complete history rather than a sample of the ones that happened
 * to be gated.
 */
export async function proposeToolCall(
  scope: Scope,
  toolId: string,
  raw: Readonly<Record<string, unknown>>,
  options: { readonly runId?: string; readonly now?: Date } = {},
): Promise<ProposeResult> {
  // The persist-then-gate-then-maybe-run order lives in proposeCore now, so the
  // assistant can propose without importing an action module. This wrapper adds
  // only what a Server Action owes the UI: revalidation.
  const outcome = await proposeCore(scope, toolId, raw, options);
  revalidatePath('/', 'layout');
  return {
    ok: outcome.ok,
    awaitingApproval: outcome.awaitingApproval,
    toolCallId: outcome.toolCallId,
    summary: outcome.summary,
  };
}


/**
 * The founder answering in the app.
 *
 * The decider is hardcoded here and is not a parameter, because this function is
 * callable from the browser: a decider on the wire would let a crafted request
 * write someone else's name onto a decision. Every entry point fixes its own —
 * see `lib/approvals/decide.ts`.
 */
export async function approveToolCall(scope: Scope, toolCallId: string): Promise<ToolOutcome> {
  const outcome = await approveToolCallAs(scope, toolCallId, LOCAL_DECIDER);
  revalidatePath('/', 'layout');
  return outcome;
}

export async function rejectToolCall(scope: Scope, toolCallId: string): Promise<void> {
  await rejectToolCallAs(scope, toolCallId, LOCAL_DECIDER);
  revalidatePath('/', 'layout');
}

export interface PendingCall {
  readonly call: ToolCall;
  /**
   * The tool's label, not the tool. A `ToolDefinition` carries `preview` as a
   * function, and a function cannot cross into a Client Component — which is
   * fine, because the preview a founder needs was computed when the call was
   * proposed and is already on the record.
   */
  readonly toolLabel?: string;
  readonly spaceLabel: string;
}

/**
 * Everything waiting on a decision, across every space the founder owns.
 *
 * This aggregates, and that is allowed: it is the founder's own inbox, assembled
 * for their own question. It never feeds agent context — `lib/ai/` cannot import
 * this file, and the isolation invariant is about what an agent may read.
 */
export async function pendingApprovals(): Promise<PendingCall[]> {
  const workspace = await getWorkspace();

  const spaces: Array<{ scope: Scope; label: string }> = [
    ...workspace.companies
      .filter((company) => !company.archivedAt)
      .map((company) => ({ scope: companyScope(company.id) as Scope, label: company.name })),
    { scope: personalScope() as Scope, label: workspace.personal.displayName },
  ];

  const pending: PendingCall[] = [];
  for (const space of spaces) {
    const calls = await readCollection(space.scope, 'toolCalls');
    for (const call of calls) {
      if (call.status !== 'awaiting-approval') continue;
      const tool = await resolveTool(call.toolId);
      pending.push({ call, spaceLabel: space.label, ...(tool ? { toolLabel: tool.label } : {}) });
    }
  }

  return pending.sort((a, b) => (a.call.at < b.call.at ? 1 : -1));
}

/**
 * Recently *decided* calls — ones a recorded decision exists for: approved,
 * rejected, or covered by a standing grant. Low-risk calls that ran because no
 * approval was required never had a decision, and counting them as "approved
 * and run" told the founder twelve things were approved on a workspace where
 * nothing ever was. Auto-run activity belongs to Mission Control and the
 * timeline, not the approvals record.
 */
export async function recentDecisions(limit = 12): Promise<PendingCall[]> {
  const workspace = await getWorkspace();

  const spaces: Array<{ scope: Scope; label: string }> = [
    ...workspace.companies
      .filter((company) => !company.archivedAt)
      .map((company) => ({ scope: companyScope(company.id) as Scope, label: company.name })),
    { scope: personalScope() as Scope, label: workspace.personal.displayName },
  ];

  const decided: PendingCall[] = [];
  for (const space of spaces) {
    const calls = await readCollection(space.scope, 'toolCalls');
    for (const call of calls) {
      if (!isDecidedCall(call)) continue;
      const tool = await resolveTool(call.toolId);
      decided.push({ call, spaceLabel: space.label, ...(tool ? { toolLabel: tool.label } : {}) });
    }
  }

  return decided
    .sort((a, b) => ((a.call.decidedAt ?? a.call.at) < (b.call.decidedAt ?? b.call.at) ? 1 : -1))
    .slice(0, limit);
}
