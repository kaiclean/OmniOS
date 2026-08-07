/**
 * The Executive Assistant.
 *
 * One entry point, one intelligence. Everything else in this directory — the
 * router, the specialists, the composers, the providers — sits behind `ask()`.
 * The founder never selects an agent; they ask, and the plan attached to the
 * answer shows who was consulted and on what evidence.
 */

import 'server-only';

import type { AgentRun, AssistantMessage, DelegationPlan, MemoryRecord } from '@/lib/domain';
import { makeRecordId, personalScope, scopeKey, sharedScope } from '@/lib/domain';
import { getWorkspace, insertRecords, readScope } from '@/lib/data/store';
import { capabilityIds } from '@/lib/capabilities/registry';
import type { AssistantContext, AssistantTarget, SpaceSlice } from './context';
import { targetKey } from './context';
import { buildDelegationPlan, route } from './router';
import { compose } from './compose';
import { activeProvider } from './providers';
import { learnFromInteraction } from '@/lib/learning/engine';

/**
 * Assemble the context a target is allowed to see.
 *
 * Space mode reads exactly one space. Founder mode reads every space the founder
 * owns — which is their own data, aggregated for their own question. A company
 * scope never reaches another company's records through either path.
 */
export async function loadContext(target: AssistantTarget, now = new Date()): Promise<AssistantContext> {
  const workspace = await getWorkspace();
  const slices: SpaceSlice[] = [];

  if (target.kind === 'founder') {
    for (const company of workspace.companies) {
      if (company.archivedAt) continue;
      const scope = { kind: 'company' as const, companyId: company.id };
      slices.push({
        scopeKey: scopeKey(scope),
        label: company.name,
        spaceKind: 'company',
        data: await readScope(scope),
      });
    }
    slices.push({
      scopeKey: 'personal',
      label: workspace.personal.displayName,
      spaceKind: 'personal',
      data: await readScope(personalScope()),
    });
  } else if (target.scope.kind === 'company') {
    const id = target.scope.companyId;
    slices.push({
      scopeKey: scopeKey(target.scope),
      label: workspace.companies.find((c) => c.id === id)?.name ?? id,
      spaceKind: 'company',
      data: await readScope(target.scope),
    });
  } else if (target.scope.kind === 'personal') {
    slices.push({
      scopeKey: 'personal',
      label: workspace.personal.displayName,
      spaceKind: 'personal',
      data: await readScope(target.scope),
    });
  }

  const sharedMemory: MemoryRecord[] = [];
  for (const capabilityId of capabilityIds()) {
    const data = await readScope(sharedScope(capabilityId));
    sharedMemory.push(...data.memory);
  }

  return {
    target,
    slices,
    sharedMemory,
    companies: workspace.companies,
    personal: workspace.personal,
    now,
  };
}

const SYSTEM_PROMPT = `You are the Executive Assistant inside OmniOS, an operating system a founder runs their companies and their private life from.

You are given an analysis that was already computed from the founder's own records. Every number in it is real. Your job is to phrase it well — never to add facts, numbers, dates or names that are not in the analysis. If something is unknown, say it is unknown.

Write like a chief of staff who respects the founder's time: direct, specific, no preamble, no flattery, no filler. Short paragraphs. Keep any figures exactly as given.`;

export interface AskResult {
  readonly message: AssistantMessage;
  readonly plan: DelegationPlan;
  readonly run: AgentRun;
}

export async function ask(
  target: AssistantTarget,
  prompt: string,
  now = new Date(),
): Promise<AskResult> {
  const startedAt = now.toISOString();
  const ctx = await loadContext(target, now);

  const allowedKinds = [...new Set(ctx.slices.map((s) => s.spaceKind))];
  // Corrections the founder made in the spaces this question can see. A hint from
  // a company the founder is not currently in never reaches this list, because the
  // slices are the only thing that was read.
  const hints = ctx.slices.flatMap((slice) => slice.data.routingHints);
  const routing = route(prompt, allowedKinds.length ? allowedKinds : ['personal'], hints);
  const composition = compose(ctx, prompt, routing);

  const plan = buildDelegationPlan({
    prompt,
    routing,
    contextUsed: composition.references,
    summary: composition.summary,
    outputs: composition.outputs,
  });

  const provider = activeProvider();
  let text = composition.body;
  let simulated = true;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  if (!provider.simulated) {
    try {
      const response = await provider.complete({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `The founder asked: "${prompt}"\n\nAnalysis computed from their records:\n\n${composition.body}\n\nWrite the reply.`,
          },
        ],
      });
      if (response.text.trim()) {
        text = response.text.trim();
        simulated = false;
        tokensIn = response.tokensIn;
        tokensOut = response.tokensOut;
      }
    } catch {
      // A provider failure must never lose the answer: the local grounding stands
      // on its own, and the UI will show that it was locally generated.
    }
  }

  const finishedAt = new Date().toISOString();
  const storageScope = target.kind === 'founder' ? personalScope() : target.scope;
  const seed = `${targetKey(target)}:${startedAt}:${prompt}`;

  const message: AssistantMessage = {
    id: makeRecordId('msg', seed),
    scope: storageScope,
    createdAt: startedAt,
    updatedAt: finishedAt,
    role: 'assistant',
    text,
    at: finishedAt,
    plan,
    simulated,
    providerId: provider.id,
  };

  const founderMessage: AssistantMessage = {
    id: makeRecordId('msg', `${seed}:founder`),
    scope: storageScope,
    createdAt: startedAt,
    updatedAt: startedAt,
    role: 'founder',
    text: prompt,
    at: startedAt,
    simulated: false,
    providerId: provider.id,
  };

  const run: AgentRun = {
    id: makeRecordId('run', seed),
    scope: storageScope,
    createdAt: startedAt,
    updatedAt: finishedAt,
    prompt,
    startedAt,
    finishedAt,
    plan,
    providerId: provider.id,
    simulated,
    ...(tokensIn === undefined ? {} : { tokensIn }),
    ...(tokensOut === undefined ? {} : { tokensOut }),
  };

  await insertRecords(storageScope, 'messages', [message, founderMessage]);
  await insertRecords(storageScope, 'agentRuns', [run]);

  // The interaction is not over when the answer is written. This is the step that
  // makes "learns with every interaction" a property of the code rather than a
  // claim in a README: observations are drawn, beliefs are reinforced or fade,
  // consulted specialists get an invocation, and used memory gets stronger.
  await learnFromInteraction({
    interaction: {
      scope: storageScope,
      prompt,
      at: startedAt,
      capabilityId: routing.lead.capabilityIds[0] ?? 'executive',
      specialistId: routing.lead.id,
      touched: plan.contextUsed.map((reference) => ({
        kind: reference.kind,
        id: reference.id,
        label: reference.label,
      })),
      outcome: 'answered',
    },
    now,
    specialistIds: [routing.lead.id, ...routing.supporting.map((s) => s.id)],
    used: plan.contextUsed,
    ...(routing.hint ? { appliedHintId: routing.hint.id } : {}),
  });

  return { message, plan, run };
}

/** Conversation history for a target, oldest first. */
export async function conversation(target: AssistantTarget): Promise<AssistantMessage[]> {
  const scope = target.kind === 'founder' ? personalScope() : target.scope;
  const data = await readScope(scope);
  return [...data.messages].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
