import 'server-only';

/**
 * Loading the context a turn is grounded in, and the system prompt built from it.
 *
 * Reads each owned scope by name; nothing here reaches across spaces.
 */

import { personalScope, scopeKey, sharedScope, type MemoryRecord } from '@/lib/domain';
import { getWorkspace, readScope } from '@/lib/data/store';
import { capabilityIds, getCapability } from '@/lib/capabilities/registry';
import { TONE_INSTRUCTION, type AssistantTone } from '@/lib/data/schema';
import { pageContextLabelParts } from '@/lib/ui/page-context';
import type { AssistantContext, AssistantTarget, SpaceSlice } from '../context';

/**
 * Founder-mode conversations store in the personal scope (it is the founder's
 * own surface) but on a reserved channel, so the "Everything" thread and the
 * personal space's own main thread stay distinct. Without it, a question asked
 * on the OS surface surfaced inside the personal space's copilot and vice
 * versa. It is not a `thread:` channel, so it never appears as a named thread.
 */
export const FOUNDER_CHANNEL = 'founder';

/** The verbs the composer can always take — offered wherever a reply would otherwise be a dead end. */
export const STANDING_VERB_ACTIONS: readonly { label: string; insert: string }[] = [
  { label: 'Create a task…', insert: '/task ' },
  { label: 'Set a goal…', insert: '/goal ' },
  { label: 'Write a doc…', insert: '/doc ' },
  { label: 'Flag a risk…', insert: '/risk ' },
  { label: 'Remember a fact…', insert: '/remember ' },
];

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

export function systemPrompt(
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
export function locationLineFor(target: AssistantTarget, ctx: AssistantContext): string | null {
  const page = target.page;
  if (!page) return null;
  const parts = pageContextLabelParts(page, {
    companyNames: Object.fromEntries(ctx.companies.map((c) => [c.id, c.name])),
    personalName: ctx.personal.displayName,
    capabilityName: (id) => getCapability(id)?.name,
  });
  return `The founder is currently looking at: ${parts.join(' / ')}. When their question is ambiguous, read it against this screen first.`;
}
