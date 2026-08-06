/**
 * Intent routing and delegation planning.
 *
 * The founder types one sentence to one assistant. This module decides which
 * specialists that sentence belongs to, in what order, and whether anything in the
 * resulting plan needs human approval before it could ever run.
 *
 * Routing is declarative: it scores the prompt against each specialist's `matches`
 * list. Adding a specialist never means editing this file.
 */

import type { DelegationPlan, DelegationStep, SpecialistAgent } from '@/lib/domain';
import { makeRecordId } from '@/lib/domain';
import { SPECIALISTS, getSpecialist } from './specialists';
import type { AssistantContext, ContextReferenceInput } from './types';

export interface RouteScore {
  readonly specialist: SpecialistAgent;
  readonly score: number;
  readonly matched: readonly string[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'my', 'me', 'i',
  'we', 'do', 'should', 'what', 'how', 'can', 'you', 'this', 'that', 'with', 'about', 'please',
]);

export function normalise(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Score every specialist the current target is allowed to use.
 *
 * Longer phrase matches outweigh single keywords, so "cash flow" reaches the
 * Finance Lead more strongly than the bare word "flow" reaches anyone.
 */
export function scoreSpecialists(
  prompt: string,
  allowedKinds: ReadonlyArray<'company' | 'personal'>,
): RouteScore[] {
  const text = normalise(prompt);
  const words = new Set(text.split(/[^a-z0-9']+/).filter((w) => w && !STOPWORDS.has(w)));

  const scores: RouteScore[] = [];
  for (const specialist of SPECIALISTS) {
    if (!specialist.allowedScopeKinds.some((k) => allowedKinds.includes(k))) continue;

    let score = 0;
    let earliest = Number.POSITIVE_INFINITY;
    const matched: string[] = [];
    for (const needle of specialist.matches) {
      const at = text.indexOf(needle);
      if (at === -1) continue;
      if (needle.includes(' ')) {
        score += 3 + needle.split(' ').length;
      } else {
        // Whole-word hits are worth more than a substring buried in another word.
        score += words.has(needle) ? 3 : 1.5;
      }
      matched.push(needle);
      earliest = Math.min(earliest, at);
    }
    if (score === 0) continue;

    // "Automate the weekly report" is an automation request; "report on our
    // automation" is an analysis request. The leading term carries the intent, so
    // an early match is worth more than a late one.
    if (text.length > 0 && Number.isFinite(earliest)) {
      score += 2 * (1 - earliest / text.length);
    }
    scores.push({ specialist, score, matched });
  }

  return scores.sort((a, b) => b.score - a.score || a.specialist.id.localeCompare(b.specialist.id));
}

/** When nothing matches, the Chief of Staff takes it — that is what a chief of staff is for. */
const FALLBACK_ID = 'chief-of-staff';

export interface RoutingResult {
  readonly lead: SpecialistAgent;
  readonly supporting: readonly SpecialistAgent[];
  readonly scores: readonly RouteScore[];
  /** 0..1 confidence that the lead is the right specialist. */
  readonly confidence: number;
}

export function route(
  prompt: string,
  allowedKinds: ReadonlyArray<'company' | 'personal'>,
): RoutingResult {
  const scores = scoreSpecialists(prompt, allowedKinds);
  const fallback = getSpecialist(FALLBACK_ID);
  if (!fallback) throw new Error('Chief of Staff specialist is missing from the registry');

  if (scores.length === 0) {
    return { lead: fallback, supporting: [], scores, confidence: 0.35 };
  }

  const top = scores[0] as RouteScore;
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  const share = total > 0 ? top.score / total : 0;
  // A clear winner with several matched phrases is worth more confidence than a
  // narrow win decided by one incidental keyword.
  const confidence = Math.min(0.96, 0.4 + share * 0.4 + Math.min(top.matched.length, 4) * 0.05);

  const supporting = scores
    .slice(1)
    .filter((s) => s.score >= top.score * 0.45)
    .slice(0, 2)
    .map((s) => s.specialist);

  return { lead: top.specialist, supporting, scores, confidence };
}

/** True when a step would reach anything outside OmniOS. Those steps stop for approval. */
function stepNeedsApproval(objective: string): boolean {
  return /\b(send|publish|post|email|pay|transfer|book|order|sign|delete|share externally)\b/i.test(
    objective,
  );
}

export interface PlanInput {
  readonly prompt: string;
  readonly routing: RoutingResult;
  readonly contextUsed: readonly ContextReferenceInput[];
  readonly summary: string;
  readonly outputs: ReadonlyMap<string, string>;
}

export function buildDelegationPlan(input: PlanInput): DelegationPlan {
  const { prompt, routing, summary, outputs } = input;
  const members = [routing.lead, ...routing.supporting];

  const steps: DelegationStep[] = members.map((specialist, i) => {
    const objective = objectiveFor(specialist, prompt, i === 0);
    const needsApproval = stepNeedsApproval(objective);
    return {
      id: makeRecordId('step', `${specialist.id}:${prompt}:${i}`),
      specialistId: specialist.id,
      objective,
      confidence: i === 0 ? routing.confidence : Math.max(0.3, routing.confidence - 0.18 * i),
      status: needsApproval ? 'needs-approval' : 'done',
      output: outputs.get(specialist.id) ?? specialist.wouldDo[0] ?? '',
      durationMs: 0,
    };
  });

  const requiresApproval = steps.some((s) => s.status === 'needs-approval');

  return {
    intent: prompt,
    summary,
    steps,
    contextUsed: input.contextUsed.map((c) => ({
      kind: c.kind,
      id: c.id,
      label: c.label,
      scopeKey: c.scopeKey,
    })),
    requiresApproval,
    ...(requiresApproval
      ? {
          approvalReason:
            'One or more steps would act outside OmniOS. Nothing leaves this system without you approving it first.',
        }
      : {}),
  };
}

function objectiveFor(specialist: SpecialistAgent, prompt: string, lead: boolean): string {
  const verb = lead ? 'Answer' : 'Review';
  const trimmed = prompt.length > 90 ? `${prompt.slice(0, 87)}…` : prompt;
  return `${verb} "${trimmed}" from the ${specialist.role.toLowerCase()} angle.`;
}

/** Used by the transparency panel: which specialists were even eligible. */
export function eligibleSpecialists(ctx: AssistantContext): SpecialistAgent[] {
  const kinds = new Set(ctx.slices.map((s) => s.spaceKind));
  return SPECIALISTS.filter((s) => s.allowedScopeKinds.some((k) => kinds.has(k)));
}
