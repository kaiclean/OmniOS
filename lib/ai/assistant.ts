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
import { makeRecordId, parseScopeKey, personalScope, scopeKey, sharedScope } from '@/lib/domain';
import type { Scope } from '@/lib/domain';
import { getWorkspace, insertRecords, readScope } from '@/lib/data/store';
import { capabilityIds, getCapability } from '@/lib/capabilities/registry';
import type { AssistantTone } from '@/lib/data/schema';
import { TONE_INSTRUCTION } from '@/lib/data/schema';
import { pageContextLabelParts } from '@/lib/ui/page-context';
import type { AssistantContext, AssistantTarget, SpaceSlice } from './context';
import { targetKey } from './context';
import { buildDelegationPlan, route } from './router';
import { rosterFor } from './roster';
import { compose } from './compose';
import { activeProvider } from './providers';
import { learnFromInteraction } from '@/lib/learning/engine';
import type { LoopResult } from './loop';
import { describeLoop, runActLoop } from './loop';
import { availableTools } from './available';
import { describeSelf } from './self';
import { NOT_WIRED_TOOL_IDS } from './tools/executors';

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

function systemPrompt(tone: AssistantTone, locationLine: string | null, self: string): string {
  return [
    `You are the Executive Assistant inside OmniOS, an operating system a founder runs their companies and their private life from.`,
    '',
    `You are given an analysis that was already computed from the founder's own records. Every number in it is real. Your job is to phrase it well — never to add facts, numbers, dates or names that are not in the analysis. If something is unknown, say it is unknown.`,
    '',
    // The tone the founder chose in settings shapes wording only. The analysis
    // was computed before the model was involved, so no tone can soften a figure.
    `Voice: ${TONE_INSTRUCTION[tone]}`,
    ...(locationLine ? ['', locationLine] : []),
    '',
    `Keep any figures exactly as given.`,
    '',
    self,
  ].join('\n');
}

/** "The founder is looking at: Meridian Build / Marketing." Wording only. */
function locationLineFor(target: AssistantTarget, ctx: AssistantContext): string | null {
  const page = target.page;
  if (!page) return null;
  const parts = pageContextLabelParts(page, {
    companyNames: Object.fromEntries(ctx.companies.map((c) => [c.id, c.name])),
    personalName: ctx.personal.displayName,
    capabilityName: (id) => getCapability(id)?.name,
  });
  return `The founder is currently looking at: ${parts.join(' / ')}. When their question is ambiguous, read it against this screen first.`;
}

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
  // In a space, that space's own roster routes — including agents the founder
  // hired there. Founder-wide questions stay with the built-ins: a custom agent
  // belongs to one scope and must never answer for the others.
  const roster = target.kind === 'space' ? await rosterFor(target.scope) : undefined;
  const routing = route(prompt, allowedKinds.length ? allowedKinds : ['personal'], hints, roster);
  const composition = compose(ctx, prompt, routing);

  // Acting. The scope a call lands in is decided here — server-side, never by
  // the model: space mode acts in that space; founder mode acts in the space of
  // the page being looked at, or nowhere. Every planned call goes through the
  // same propose→gate path as a typed form.
  const provider = await activeProvider();
  const actScope: Scope | null =
    target.kind === 'space'
      ? target.scope
      : target.page && target.page.spaceKey !== 'os'
        ? (parseScopeKey(target.page.spaceKey) ?? null)
        : null;

  const actLines: string[] = [];
  let loopResult: LoopResult | undefined;
  if (actScope && actScope.kind !== 'shared') {
    loopResult = await runActLoop(prompt, {
      scope: actScope,
      provider,
      now,
      ...(target.page?.capabilityId ? { preferCapabilityId: target.page.capabilityId } : {}),
    });
    actLines.push(...describeLoop(loopResult));
  }

  const plan = buildDelegationPlan({
    prompt,
    routing,
    contextUsed: composition.references,
    summary: composition.summary,
    outputs: composition.outputs,
  });

  let text = composition.body;
  let simulated = true;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  // What the loop actually found, for the answering model. Without this the
  // voice contradicts the evidence: observed live, a search returned three
  // matching tasks and the reply said "no task record exists" in the same
  // breath, because the results were pasted above the answer rather than given
  // to the thing writing it.
  const loopFindings =
    loopResult && loopResult.steps.length > 0
      ? `\n\nWhat you did this turn, and what each step returned. These results are fresher than the analysis above — where they disagree, the results win:\n${loopResult.steps
          .map((step) => `- ${step.toolId}: ${step.summary}`)
          .join('\n')}`
      : '';

  if (!provider.simulated) {
    try {
      const workspace = await getWorkspace();
      const response = await provider.complete({
        messages: [
          {
            role: 'system',
            content: systemPrompt(
              workspace.settings.assistantTone,
              locationLineFor(target, ctx),
              // Rides on every turn. Without it the assistant reasons about its
              // own abilities from priors about assistants in general, which is
              // how it ends up telling the founder to ask somebody else.
              // Built-in *and* bridged: the answering half must know exactly
              // what the planning half can reach, or it disclaims abilities the
              // loop just used.
              describeSelf({
                // Founder mode has no single acting scope, but it is not
                // powerless — it is the surface where "what can you do?" is most
                // often asked. Handing it `[]` made the assistant state with
                // total confidence that it had no tools and no connections,
                // which is the failure `self.ts` exists to prevent, inverted:
                // a confident falsehood instead of an honest hedge. Describe the
                // personal scope's toolset, which is every founder-mode space's
                // built-ins plus the same connections.
                tools: await availableTools(
                  actScope && actScope.kind !== 'shared' ? actScope : personalScope(),
                ),
                servers: workspace.mcpServers,
                states: workspace.mcpStates,
                unwiredToolIds: NOT_WIRED_TOOL_IDS,
              }),
            ),
          },
          {
            role: 'user',
            content: `The founder asked: "${prompt}"\n\nAnalysis computed from their records:\n\n${composition.body}${loopFindings}\n\nWrite the reply.`,
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

  if (actLines.length > 0) {
    text = `${actLines.join('\n')}\n\n${text}`;
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

/** Conversation history for a target, oldest first. Direct agent chats stay out. */
export async function conversation(target: AssistantTarget): Promise<AssistantMessage[]> {
  const scope = target.kind === 'founder' ? personalScope() : target.scope;
  const data = await readScope(scope);
  return data.messages
    .filter((message) => !message.channel)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
