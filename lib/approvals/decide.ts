import 'server-only';

/**
 * Writing down a per-call decision — the deciding half of the gate.
 *
 * Extracted from `lib/actions/tools.ts` for one reason, and it is a security
 * reason rather than a tidiness one. A Server Action is callable from the
 * browser with whatever arguments the browser chooses. The moment "who decided"
 * became a real question — because a decision can now arrive from Telegram — it
 * could not also become a *parameter* of the action, or a crafted request would
 * be able to write `telegram:555` onto a call the founder never saw.
 *
 * So the decider is fixed by the entry point, never carried across the wire:
 * `lib/actions/tools.ts` passes the local founder and nothing else, and the
 * webhook passes the chat the callback was cryptographically bound to. This
 * module is the one place a per-call decision is written, and it is not
 * reachable from a client.
 *
 * The order below is the invariant, unchanged from where it used to live: the
 * decision is persisted *before* `runTool` is invoked, and the same timestamp is
 * handed to the executor. If the run then fails, the record still shows that a
 * human said yes — which is the truth, and is what an audit of "who authorised
 * this" needs.
 */

import type { Scope, ToolCall, ToolOutcome } from '@/lib/domain';
import { readCollection, updateRecord } from '@/lib/data/store';
import { runTool } from '@/lib/ai/tools/executors';
import { resolveSecrets } from '@/lib/secrets/vault';

/** The decider when the founder answered in the app itself. */
export const LOCAL_DECIDER = 'founder';

export async function findToolCall(scope: Scope, toolCallId: string): Promise<ToolCall | undefined> {
  const calls = await readCollection(scope, 'toolCalls');
  return calls.find((call) => call.id === toolCallId);
}

export async function approveToolCallAs(
  scope: Scope,
  toolCallId: string,
  decidedBy: string,
): Promise<ToolOutcome> {
  const call = await findToolCall(scope, toolCallId);
  if (!call) return { ok: false, summary: 'That call is not in this space.', error: 'not-found' };
  if (call.status !== 'awaiting-approval') {
    return { ok: false, summary: `That call was already ${call.status}.`, error: 'not-pending' };
  }

  const now = new Date();
  const decidedAt = now.toISOString();
  await updateRecord(scope, 'toolCalls', toolCallId, { status: 'approved', decidedAt, decidedBy });

  const outcome = await runTool(
    call.toolId,
    { scope, now, actor: decidedBy, resolveSecrets },
    call.args,
    { approval: { decidedBy, decidedAt } },
  );

  await updateRecord(scope, 'toolCalls', toolCallId, {
    status: outcome.ok ? 'executed' : 'failed',
    result: outcome.summary,
    affectedIds: outcome.affectedIds ?? [],
    ...(outcome.error ? { error: outcome.error } : {}),
  });

  return outcome;
}

export async function rejectToolCallAs(
  scope: Scope,
  toolCallId: string,
  decidedBy: string,
): Promise<boolean> {
  const call = await findToolCall(scope, toolCallId);
  if (!call || call.status !== 'awaiting-approval') return false;

  await updateRecord(scope, 'toolCalls', toolCallId, {
    status: 'rejected',
    decidedAt: new Date().toISOString(),
    decidedBy,
    // Kept, not deleted: a rejected proposal is evidence about what the system
    // tried to do, and the learning engine reads exactly this to stop suggesting it.
    result: 'Rejected. Nothing ran.',
  });
  return true;
}
