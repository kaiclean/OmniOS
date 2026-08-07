import 'server-only';

/**
 * Act, look at what happened, act again.
 *
 * `detectAct` plans from the prompt alone, which is enough for "create a task
 * called X" and not enough for anything real. The founder who says "is the
 * Rothbau contract already tracked, and if not add it" is asking for two steps
 * where the second depends on the first — and a planner that never sees a tool
 * result cannot do that. It could only guess, and guessing writes records.
 *
 * So this is a loop, and the shape is the standard one: plan, run, feed the
 * results back, plan again, stop when there is nothing left to do. What makes
 * it safe is not the loop, it is what the loop is made of.
 *
 * **The gate is not something the loop can outrun.** Every call goes through
 * `proposeCore`, exactly as a single-shot turn did. A `destructive` or
 * `external` call still stops at `awaiting-approval` — and when one does, the
 * loop *halts* rather than continuing around it. Continuing would mean planning
 * the next step on the assumption the founder will say yes, which is precisely
 * the assumption the gate exists to refuse.
 *
 * **Autonomy is bounded by tier, not by trust.** Between rounds the loop only
 * ever carries forward results from calls that already ran, which are `read` and
 * `write` — the tiers that were autonomous before this file existed. Nothing
 * here widens what may run unattended; it only lets the assistant find out
 * something and then use it.
 */

import type { LlmProvider, Scope } from '@/lib/domain';
import { detectAct, type PlannedCall } from './act';
import { proposeCore } from './tools/propose';

/**
 * Four is enough for "look it up, then act on what you found", and short enough
 * that a model stuck in a groove costs seconds rather than a bill.
 */
const MAX_ROUNDS = 4;
const MAX_CALLS = 8;

export interface LoopStep {
  readonly toolId: string;
  readonly summary: string;
  readonly awaitingApproval: boolean;
  readonly ok: boolean;
}

export interface LoopResult {
  readonly steps: readonly LoopStep[];
  /** Set when the loop stopped early, and why — never left for the reader to infer. */
  readonly haltedBecause?: 'awaiting-approval' | 'round-limit' | 'call-limit';
  readonly note?: string;
}

/** What the planner is told about a round that already happened. */
function observation(call: PlannedCall, summary: string): string {
  return `You called ${call.toolId} and it returned:\n${summary}`;
}

export async function runActLoop(
  prompt: string,
  options: {
    readonly scope: Scope;
    readonly provider: LlmProvider;
    readonly now: Date;
    readonly preferCapabilityId?: string;
  },
): Promise<LoopResult> {
  const steps: LoopStep[] = [];
  const observations: string[] = [];
  let note: string | undefined;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // The prompt grows with what has been learned. The planner sees the founder's
    // original words every round — a summary of a summary is how intent drifts.
    const enriched =
      observations.length === 0
        ? prompt
        : `${prompt}\n\nWhat you have already done this turn:\n${observations.join('\n\n')}\n\nContinue if there is a next step, otherwise answer.`;

    const decision = await detectAct(enriched, {
      scope: options.scope,
      provider: options.provider,
      now: options.now,
      ...(options.preferCapabilityId ? { preferCapabilityId: options.preferCapabilityId } : {}),
    });

    if (decision.note && !note) note = decision.note;
    if (decision.mode !== 'act' || decision.calls.length === 0) {
      return { steps, ...(note ? { note } : {}) };
    }

    for (const planned of decision.calls) {
      if (steps.length >= MAX_CALLS) {
        return { steps, haltedBecause: 'call-limit', ...(note ? { note } : {}) };
      }

      const outcome = await proposeCore(options.scope, planned.toolId, planned.args, {
        now: options.now,
      });
      steps.push({
        toolId: planned.toolId,
        summary: outcome.awaitingApproval ? outcome.preview : outcome.summary,
        awaitingApproval: outcome.awaitingApproval,
        ok: outcome.ok,
      });

      if (outcome.awaitingApproval) {
        // Stop. Planning past a gated call would mean planning on the assumption
        // that the founder will approve it, and an assistant that assumes a yes
        // has already decided for them.
        return { steps, haltedBecause: 'awaiting-approval', ...(note ? { note } : {}) };
      }

      observations.push(observation(planned, outcome.summary));
    }
  }

  return { steps, haltedBecause: 'round-limit', ...(note ? { note } : {}) };
}

/** The reply text for a loop, stating per step what actually happened. */
export function describeLoop(result: LoopResult): string[] {
  const lines = result.steps.map((step) =>
    step.awaitingApproval
      ? `Queued for your approval: ${step.summary} Decide it under Approvals.`
      : step.ok
        ? `Done: ${step.summary}`
        : `Could not run ${step.toolId}: ${step.summary}`,
  );

  if (result.haltedBecause === 'awaiting-approval') {
    lines.push('I stopped there — the rest depends on that decision.');
  } else if (result.haltedBecause === 'round-limit' || result.haltedBecause === 'call-limit') {
    lines.push('I stopped after several steps rather than keep going unattended. Say “continue” if that was right.');
  }

  if (result.note) lines.push(result.note);
  return lines;
}
