/**
 * The Executive Assistant.
 *
 * One entry point, one intelligence. Everything else in this directory — the
 * router, the specialists, the composers, the providers — sits behind `ask()`.
 * The founder never selects an agent; they ask, and the plan attached to the
 * answer shows who was consulted and on what evidence.
 */

import 'server-only';

import type { AgentRun, AssistantMessage, DelegationPlan, MemoryRecord, SpecialistAgent } from '@/lib/domain';
import { agentIdFrom, makeRecordId, parseScopeKey, personalScope, scopeKey, sharedScope } from '@/lib/domain';
import type { Scope } from '@/lib/domain';
import { getWorkspace, insertRecords, readScope } from '@/lib/data/store';
import { capabilityIds, getCapability } from '@/lib/capabilities/registry';
import type { AssistantTone } from '@/lib/data/schema';
import { TONE_INSTRUCTION } from '@/lib/data/schema';
import { pageContextLabelParts } from '@/lib/ui/page-context';
import type { AssistantContext, AssistantTarget, SpaceSlice } from './context';
import { targetKey } from './context';
import { buildDelegationPlan, route } from './router';
import { SLASH_COMMANDS } from './commands';
import { SPECIALISTS } from './specialists';
import { rosterFor } from './roster';
import { proposeCore } from './tools/propose';
import { compose } from './compose';
import { activeProvider } from './providers';
import { learnFromInteraction } from '@/lib/learning/engine';
import type { LoopResult } from './loop';
import { describeLoop, runActLoop } from './loop';
import { availableTools } from './available';
import { describeSelf } from './self';
import { recallAcrossSpaces, type SpaceRecallSource } from './recall';
import { NOT_WIRED_TOOL_IDS } from './tools/executors';

/**
 * Founder-mode conversations store in the personal scope (it is the founder's
 * own surface) but on a reserved channel, so the "Everything" thread and the
 * personal space's own main thread stay distinct. Without it, a question asked
 * on the OS surface surfaced inside the personal space's copilot and vice
 * versa. It is not a `thread:` channel, so it never appears as a named thread.
 */
const FOUNDER_CHANNEL = 'founder';

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

function systemPrompt(
  tone: AssistantTone,
  locationLine: string | null,
  recalled: string,
  self: string,
): string {
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
    ...(recalled ? ['', recalled] : []),
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

/**
 * "@engineer how risky is this migration" — the founder names the voice.
 *
 * A mention only re-weights who *answers*; it grants nothing. The named
 * specialist must already be on the roster this target may use, and an unknown
 * slug is left in the text rather than guessed at.
 */
function parseMention(
  prompt: string,
  roster: readonly SpecialistAgent[],
): { specialist: SpecialistAgent; rest: string } | null {
  const match = /^@([a-z0-9][a-z0-9-]*)\s+(.+)$/s.exec(prompt.trim());
  if (!match?.[1] || !match[2]) return null;
  const slug = match[1];
  const specialist = roster.find(
    (candidate) => candidate.id === slug || agentIdFrom(candidate.name) === slug,
  );
  return specialist ? { specialist, rest: match[2].trim() } : null;
}

/**
 * Slash commands are the deterministic fast path: no model, no routing
 * ambiguity — "/task Buy the domain" is exactly one proposal, validated and
 * gated like anything else. The registry lives in `./commands` so the composer
 * lists exactly what the server parses.
 */
function parseSlashCommand(prompt: string): { toolId: string; args: Record<string, string>; label: string } | null {
  const match = /^\/([a-z]+)\s+(.+)$/s.exec(prompt.trim());
  if (!match?.[1] || !match[2]) return null;
  const entry = SLASH_COMMANDS.find((candidate) => candidate.command === match[1]);
  return entry
    ? { toolId: entry.toolId, args: { [entry.argName]: match[2].trim() }, label: entry.command }
    : null;
}

export async function ask(
  target: AssistantTarget,
  prompt: string,
  now = new Date(),
  options: { readonly channel?: string } = {},
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

  // "@name …" and "/command …" are resolved before anything else reads the
  // text: routing, composition and the act loop all see the cleaned sentence,
  // while the stored founder message keeps the original words.
  const mention = parseMention(prompt, roster ?? SPECIALISTS);
  const slash = mention ? null : parseSlashCommand(prompt);
  const spoken = mention ? mention.rest : prompt;

  let routing = route(spoken, allowedKinds.length ? allowedKinds : ['personal'], hints, roster);
  if (mention) {
    const supporting = [routing.lead, ...routing.supporting]
      .filter((candidate) => candidate.id !== mention.specialist.id)
      .slice(0, 2);
    routing = {
      ...routing,
      lead: mention.specialist,
      supporting,
      // Being told beats being inferred — same ceiling an exact hint gets.
      confidence: Math.max(routing.confidence, 0.9),
    };
  }
  const composition = compose(ctx, spoken, routing);

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
    if (slash) {
      // The deterministic path: one named tool, one proposal, the same gate.
      const outcome = await proposeCore(actScope, slash.toolId, slash.args, { now });
      actLines.push(
        outcome.awaitingApproval
          ? `Queued for your approval: ${outcome.preview} Decide it under Approvals.`
          : outcome.ok
            ? `Done: ${outcome.summary}`
            : `Could not /${slash.label}: ${outcome.summary}`,
      );
    } else {
      loopResult = await runActLoop(spoken, {
        scope: actScope,
        provider,
        now,
        ...(target.page?.capabilityId ? { preferCapabilityId: target.page.capabilityId } : {}),
      });
      actLines.push(...describeLoop(loopResult));
    }
  } else if (slash) {
    actLines.push('A /command acts inside a space — open a company or your life first.');
  }

  /**
   * What this question needs from memory, ranked — not the first few records
   * that happened to load. In a space, that space's memory answers. On the
   * founder surface there is no single space, so recall walks every space the
   * founder owns — the same set, in the same way, as `loadContext` above — and
   * labels each hit with where it came from. Recalling only from personal here
   * was the `describeSelf` bug in another coat: a question about a company on
   * an OS-level page could never surface that company's memories.
   */
  const recallSources: SpaceRecallSource[] =
    actScope && actScope.kind !== 'shared'
      ? [
          {
            scope: actScope,
            label:
              actScope.kind === 'company'
                ? (ctx.companies.find((c) => c.id === actScope.companyId)?.name ?? actScope.companyId)
                : ctx.personal.displayName,
          },
        ]
      : [
          ...ctx.companies
            .filter((company) => !company.archivedAt)
            .map((company) => ({
              scope: { kind: 'company' as const, companyId: company.id },
              label: company.name,
            })),
          { scope: personalScope(), label: ctx.personal.displayName },
        ];
  const recalledHits = await recallAcrossSpaces(recallSources, { text: prompt, limit: 5, now });
  const recalled =
    recalledHits.length > 0
      ? `What you know about this founder that bears on this question, most relevant first. Use it to shape the reply; never state it back as a finding:\n${recalledHits
          .map((hit) => `- [${hit.spaceLabel}] ${hit.record.text}`)
          .join('\n')}`
      : '';

  const plan = buildDelegationPlan({
    prompt: spoken,
    routing,
    contextUsed: composition.references,
    summary: composition.summary,
    outputs: composition.outputs,
  });

  // A command gets a receipt, not a briefing. Observed live: "/task …" was
  // confirmed in one line and then buried under a marketing report, because the
  // composition was appended to every reply regardless of what the founder
  // asked for. When the turn was an instruction, what happened *is* the answer.
  const commandTurn = slash !== null || loopResult?.intent === 'command';

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

  if (!provider.simulated && !commandTurn) {
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
              recalled,
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
            content: `The founder asked: "${spoken}"\n\nAnalysis computed from their records:\n\n${composition.body}${loopFindings}\n\nWrite the reply.`,
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

  if (commandTurn && actLines.length > 0) {
    text = actLines.join('\n');
  } else if (actLines.length > 0) {
    text = `${actLines.join('\n')}\n\n${text}`;
  }

  const finishedAt = new Date().toISOString();
  const storageScope = target.kind === 'founder' ? personalScope() : target.scope;
  // A named thread keeps its own id; the main thread of founder mode is the
  // reserved channel, and of a space is no channel at all.
  const storedChannel =
    options.channel ?? (target.kind === 'founder' ? FOUNDER_CHANNEL : undefined);
  const seed = `${targetKey(target)}:${startedAt}:${prompt}`;

  const message: AssistantMessage = {
    id: makeRecordId('msg', seed),
    scope: storageScope,
    createdAt: startedAt,
    updatedAt: finishedAt,
    role: 'assistant',
    text,
    at: finishedAt,
    // A command's reply is a receipt; attaching the routing plan would claim
    // specialists were consulted on an instruction none of them touched.
    ...(commandTurn ? {} : { plan }),
    simulated,
    providerId: provider.id,
    ...(storedChannel ? { channel: storedChannel } : {}),
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
    ...(storedChannel ? { channel: storedChannel } : {}),
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

/**
 * Conversation history for a target, oldest first. No channel = the main
 * thread; a `thread:` channel = one named conversation. Direct agent chats
 * live on `agent:` channels and never appear here.
 */
export async function conversation(
  target: AssistantTarget,
  channel?: string,
): Promise<AssistantMessage[]> {
  const scope = target.kind === 'founder' ? personalScope() : target.scope;
  const data = await readScope(scope);
  // The main thread means the reserved founder channel on the OS surface, and no
  // channel in a space — so the two never bleed into each other.
  const effectiveChannel = channel ?? (target.kind === 'founder' ? FOUNDER_CHANNEL : undefined);
  return data.messages
    .filter((message) => (effectiveChannel ? message.channel === effectiveChannel : !message.channel))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export interface ThreadSummary {
  readonly channel: string;
  readonly title: string;
  readonly at: string;
  readonly count: number;
}

/**
 * The named conversations a target has, newest first — derived entirely from
 * the messages themselves. A conversation has no record of its own: its title
 * is its first question, its age is its last message, and deleting its
 * messages deletes it. Nothing to rename, nothing to drift.
 */
export async function listThreads(target: AssistantTarget): Promise<ThreadSummary[]> {
  const scope = target.kind === 'founder' ? personalScope() : target.scope;
  const data = await readScope(scope);
  const byChannel = new Map<string, { first?: AssistantMessage; last?: AssistantMessage; count: number }>();

  for (const message of data.messages) {
    if (!message.channel?.startsWith('thread:')) continue;
    const entry = byChannel.get(message.channel) ?? { count: 0 };
    entry.count += 1;
    if (!entry.first || message.at < entry.first.at) entry.first = message;
    if (!entry.last || message.at > entry.last.at) entry.last = message;
    byChannel.set(message.channel, entry);
  }

  return [...byChannel.entries()]
    .map(([channel, entry]) => {
      const opening =
        entry.first?.role === 'founder' ? entry.first.text : (entry.first?.text ?? 'Conversation');
      return {
        channel,
        title: opening.length > 60 ? `${opening.slice(0, 60)}…` : opening,
        at: entry.last?.at ?? '',
        count: entry.count,
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
