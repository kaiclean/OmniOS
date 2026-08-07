'use server';

import { revalidatePath } from 'next/cache';

import type { Scope, ToolCall, ToolOutcome } from '@/lib/domain';
import { companyScope, makeRecordId, personalScope, requiresApproval, scopeKey, validateArgs } from '@/lib/domain';
import { getWorkspace, insertRecords, readCollection, updateRecord } from '@/lib/data/store';
import { resolveTool, runTool } from '@/lib/ai/tools/executors';
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

/** The founder is the only actor; recording it makes the audit trail explicit. */
const ACTOR = 'founder';

function contextFor(scope: Scope, now: Date) {
  return { scope, now, actor: ACTOR, resolveSecrets };
}

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

async function findCall(scope: Scope, toolCallId: string): Promise<ToolCall | undefined> {
  const calls = await readCollection(scope, 'toolCalls');
  return calls.find((call) => call.id === toolCallId);
}

/**
 * Record the decision, then act on it.
 *
 * The decision is written to the record before `runTool` is invoked, and the
 * same timestamp is handed to the executor as the approval. If the run then
 * fails, the record still shows that a human said yes — which is the truth, and
 * is what an audit of "who authorised this" needs.
 */
export async function approveToolCall(scope: Scope, toolCallId: string): Promise<ToolOutcome> {
  const call = await findCall(scope, toolCallId);
  if (!call) return { ok: false, summary: 'That call is not in this space.', error: 'not-found' };
  if (call.status !== 'awaiting-approval') {
    return { ok: false, summary: `That call was already ${call.status}.`, error: 'not-pending' };
  }

  const now = new Date();
  const decidedAt = now.toISOString();
  await updateRecord(scope, 'toolCalls', toolCallId, {
    status: 'approved',
    decidedAt,
    decidedBy: ACTOR,
  });

  const outcome = await runTool(call.toolId, contextFor(scope, now), call.args, {
    approval: { decidedBy: ACTOR, decidedAt },
  });

  await updateRecord(scope, 'toolCalls', toolCallId, {
    status: outcome.ok ? 'executed' : 'failed',
    result: outcome.summary,
    affectedIds: outcome.affectedIds ?? [],
    ...(outcome.error ? { error: outcome.error } : {}),
  });

  revalidatePath('/', 'layout');
  return outcome;
}

export async function rejectToolCall(scope: Scope, toolCallId: string): Promise<void> {
  const call = await findCall(scope, toolCallId);
  if (!call || call.status !== 'awaiting-approval') return;

  await updateRecord(scope, 'toolCalls', toolCallId, {
    status: 'rejected',
    decidedAt: new Date().toISOString(),
    decidedBy: ACTOR,
    // Kept, not deleted: a rejected proposal is evidence about what the system
    // tried to do, and the learning engine reads exactly this to stop suggesting it.
    result: 'Rejected. Nothing ran.',
  });

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

/** Recently decided calls, so the inbox can show what it just did. */
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
      if (call.status === 'awaiting-approval') continue;
      const tool = await resolveTool(call.toolId);
      decided.push({ call, spaceLabel: space.label, ...(tool ? { toolLabel: tool.label } : {}) });
    }
  }

  return decided
    .sort((a, b) => ((a.call.decidedAt ?? a.call.at) < (b.call.decidedAt ?? b.call.at) ? 1 : -1))
    .slice(0, limit);
}
