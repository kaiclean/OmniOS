/**
 * Learning from the founder's own gate decisions.
 *
 * Approving or rejecting a gated tool call is the most explicit signal this
 * system ever receives: unlike a phrase or a timestamp, it is a decision the
 * founder made on a preview of exactly what would happen. Until this module,
 * that signal was written to the ToolCall record and then never read again —
 * the tenth rejection of the same delegated call looked identical to the
 * first, and nothing on the record said "stop proposing this".
 *
 * The belief formed here is per *tool*, not per call: the signature is the
 * toolId, so ten approvals of `mcp:deepseek-harness:run_task` become one
 * strengthening observation rather than ten near-duplicates, and repeated
 * rejections surface in the brain as a belief the founder can confirm or
 * retire like any other. Retirement wins forever — `mergeObservations` refuses
 * to re-learn a retired belief, so "stop concluding that from my rejections"
 * sticks.
 *
 * Pure on purpose, like the rest of the detectors: it takes the decision and
 * returns a candidate. Writing it into a scope is `learnFromDecision` in
 * `engine.ts`, and the call site is `lib/approvals/decide.ts` — the one place
 * a per-call decision is recorded, which means the Telegram path teaches the
 * system exactly as the in-app button does.
 */

import type { Observation, Scope, Timestamp } from '@/lib/domain';
import { OPENING_CONFIDENCE, observationId } from './observe';

export type ToolDecisionOutcome = 'approved' | 'rejected';

export interface ToolDecision {
  readonly scope: Scope;
  readonly toolId: string;
  /** The tool's human label — the belief must read as a sentence, not an id. */
  readonly toolLabel: string;
  readonly capabilityId: string;
  /** The preview persisted at proposal time — what the founder actually decided on. */
  readonly preview: string;
  readonly decision: ToolDecisionOutcome;
  readonly at: Timestamp;
}

const MAX_EVIDENCE_LENGTH = 140;

/** One candidate belief per decision — reinforcement and retirement are `reinforce.ts`'s job. */
export function observeDecision(decision: ToolDecision): Observation {
  const approved = decision.decision === 'approved';
  const signature = `${approved ? 'approves' : 'rejects'}-tool:${decision.toolId}`;
  const evidence = decision.preview.trim().replace(/\s+/g, ' ').slice(0, MAX_EVIDENCE_LENGTH);

  return {
    id: observationId(decision.scope, signature),
    scope: decision.scope,
    createdAt: decision.at,
    updatedAt: decision.at,
    kind: 'outcome',
    text: approved
      ? `Approves "${decision.toolLabel}" when it asks first.`
      : `Rejects "${decision.toolLabel}" proposals.`,
    capabilityId: decision.capabilityId,
    confidence: OPENING_CONFIDENCE.outcome,
    evidence: evidence ? [evidence] : [],
    source: 'outcome',
    reinforcements: 0,
    lastSeenAt: decision.at,
  };
}
