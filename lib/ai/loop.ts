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

import type { LlmMessage, LlmProvider, Scope, ToolDefinition } from '@/lib/domain';
import { readCollection } from '@/lib/data/store';
import type { CollectionName } from '@/lib/data/schema';
import { detectAct, type PlannedCall } from './act';
import { availableTools, toolsForAgent } from './available';
import { proposeCore } from './tools/propose';

/**
 * A founder deletes by name, never by id — "delete the task 'X'" carries a
 * title, and the executor rightly refuses an id it cannot find. Resolving the
 * name through the scope is a read, and the id it yields is still exactly the
 * record the founder pointed at. Ambiguity refuses rather than guesses: with
 * two matches, deleting either one would be deciding for them.
 */
async function resolveDeleteTarget(
  scope: Scope,
  collection: string,
  reference: string,
): Promise<{ id: string } | { note: string }> {
  const records = (await readCollection(scope, collection as CollectionName)) as unknown as ReadonlyArray<
    Record<string, unknown> & { id: string }
  >;
  if (records.some((record) => record.id === reference)) return { id: reference };

  const titleOf = (record: Record<string, unknown>): string => {
    for (const field of ['title', 'label', 'name', 'text'] as const) {
      const value = record[field];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  };
  const wanted = reference.trim().toLowerCase();
  const exact = records.filter((record) => titleOf(record).trim().toLowerCase() === wanted);
  const pool = exact.length > 0 ? exact : records.filter((record) => titleOf(record).toLowerCase().includes(wanted));

  if (pool.length === 1 && pool[0]) return { id: pool[0].id };
  if (pool.length === 0) {
    return { note: `I could not find “${reference}” in ${collection} here, so nothing was deleted.` };
  }
  return {
    note: `“${reference}” matches ${pool.length} records in ${collection} — say more of the exact title: ${pool
      .slice(0, 3)
      .map((record) => `“${titleOf(record)}”`)
      .join(', ')}. Nothing was deleted.`,
  };
}

/**
 * Four rounds is enough for "look it up, then act on what you found". Twelve
 * calls — the most four rounds can plan — is enough to stand up a whole
 * delegated company in one turn: the space, goals, KPIs, a model doc, starting
 * tasks and a cadence. Eight was not, and halting mid-setup with "say continue"
 * made the commonest delegation feel broken. Both stay small enough that a
 * model stuck in a groove costs seconds rather than a bill.
 */
const MAX_ROUNDS = 4;
const MAX_CALLS = 12;

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
  /** 'command' when any round wanted a change made — the reply is then a receipt, not a briefing. */
  readonly intent?: 'command';
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
    /**
     * Confine this turn to one operator's charter. Subtractive only — see
     * `toolsForAgent`. Absent means the founder's own assistant, which reaches
     * everything the space has.
     */
    readonly agent?: { readonly toolIds?: readonly string[]; readonly capabilityIds?: readonly string[] };
    /** This conversation's recent turns — see `detectAct` on why the planner needs its own past. */
    readonly history?: readonly LlmMessage[];
  },
): Promise<LoopResult> {
  const steps: LoopStep[] = [];
  const observations: string[] = [];
  let note: string | undefined;
  let intent: 'command' | undefined;

  // Resolved once per turn rather than per round: a connection cannot appear
  // mid-turn, and re-probing the workspace between rounds would make the tools
  // the planner sees depend on how long it had been thinking.
  const all = await availableTools(options.scope);
  const tools = options.agent ? toolsForAgent(all, options.agent) : all;

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
      tools,
      ...(options.history ? { history: options.history } : {}),
      ...(options.preferCapabilityId ? { preferCapabilityId: options.preferCapabilityId } : {}),
    });

    if (decision.note && !note) note = decision.note;
    if (decision.intent === 'command') intent = 'command';
    if (decision.mode !== 'act' || decision.calls.length === 0) {
      return { steps, ...(note ? { note } : {}), ...(intent ? { intent } : {}) };
    }

    for (let planned of decision.calls) {
      if (steps.length >= MAX_CALLS) {
        return { steps, haltedBecause: 'call-limit', ...(note ? { note } : {}), ...(intent ? { intent } : {}) };
      }

      if (planned.toolId === 'delete_record') {
        const collection = String(planned.args['collection'] ?? '');
        const reference = String(planned.args['recordId'] ?? '');
        const resolved = await resolveDeleteTarget(options.scope, collection, reference);
        if ('note' in resolved) {
          // Halt rather than retry: the same sentence will resolve the same way,
          // and only the founder can supply the missing precision.
          return { steps, note: resolved.note, ...(intent ? { intent } : {}) };
        }
        planned = { ...planned, args: { ...planned.args, recordId: resolved.id } };
      }

      const outcome = await proposeCore(options.scope, planned.toolId, planned.args, {
        now: options.now,
        // Distinct per step, so two identical calls in one turn are two records
        // rather than one id written twice. Deterministic, so tests stay stable.
        sequence: steps.length,
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
        return { steps, haltedBecause: 'awaiting-approval', ...(note ? { note } : {}), ...(intent ? { intent } : {}) };
      }

      observations.push(observation(planned, outcome.summary));
    }
  }

  return { steps, haltedBecause: 'round-limit', ...(note ? { note } : {}), ...(intent ? { intent } : {}) };
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
