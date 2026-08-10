'use server';

import { revalidatePath } from 'next/cache';

import type { AssistantMessage } from '@/lib/domain';
import { parseScopeKey } from '@/lib/domain';
import type { AssistantTarget } from '@/lib/ai/context';
import type { ThreadSummary } from '@/lib/ai/assistant';
import { ask, conversation, listThreads } from '@/lib/ai/assistant';
import { activeProvider } from '@/lib/ai/providers';
import { getCapability } from '@/lib/capabilities/registry';
import { derivePageContext } from '@/lib/ui/page-context';
import { credentialShape } from '@/lib/domain';

export interface AssistantTurn {
  readonly ok: boolean;
  readonly message?: AssistantMessage;
  readonly error?: string;
}

/**
 * Resolve a target key sent from the browser.
 *
 * The client only ever sends a key, never a scope object — so a crafted value
 * cannot conjure a scope that does not exist. Anything unrecognised falls back
 * to founder mode rather than throwing, because an assistant that refuses to
 * answer because of a routing detail is worse than one that answers broadly.
 */
function resolveTarget(targetKey: string, pathname?: string): AssistantTarget {
  // The page is re-derived from the pathname here, never accepted as an object:
  // a crafted payload cannot claim a capability the route does not have, and an
  // id that names no real capability is dropped rather than echoed into prompts.
  const page = pathname ? derivePageContext(pathname.slice(0, 300)) : undefined;
  const checked =
    page && (!page.capabilityId || getCapability(page.capabilityId)) ? page : undefined;

  if (!targetKey || targetKey === 'founder' || targetKey === 'os') {
    return { kind: 'founder', ...(checked ? { page: checked } : {}) };
  }
  const scope = parseScopeKey(targetKey);
  if (!scope || scope.kind === 'shared') {
    return { kind: 'founder', ...(checked ? { page: checked } : {}) };
  }
  return { kind: 'space', scope, ...(checked ? { page: checked } : {}) };
}

/** A channel from the browser is either absent or a well-formed thread id. */
function sanitiseChannel(channel?: string): string | undefined {
  return channel && /^thread:[a-z0-9-]{4,40}$/.test(channel) ? channel : undefined;
}

export async function askAssistant(
  targetKey: string,
  prompt: string,
  pathname?: string,
  channel?: string,
): Promise<AssistantTurn> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, error: 'Say something first.' };
  if (trimmed.length > 4000) {
    return { ok: false, error: 'That is longer than the assistant accepts in one turn.' };
  }

  // Refused here, before `ask()` — which is the only place it can be refused
  // usefully. One turn later the text is already in `messages` and `agentRuns`
  // on disk, and already sent to whichever model is configured; deleting the
  // record afterwards does not un-send it. The vault guards secrets on the way
  // out and nothing guarded the way in, so a token pasted into the composer
  // while setting a connector up landed in plaintext in a scope file.
  const credential = credentialShape(trimmed);
  if (credential) {
    return {
      ok: false,
      error: `That looks like it contains a ${credential}, so I have not stored or sent it. Put it in the vault instead — Connections → Keys and secrets — and refer to it here by name. If it was a real credential, treat it as exposed and rotate it.`,
    };
  }

  try {
    const thread = sanitiseChannel(channel);
    const { message } = await ask(
      resolveTarget(targetKey, pathname),
      trimmed,
      new Date(),
      thread ? { channel: thread } : {},
    );
    revalidatePath('/', 'layout');
    return { ok: true, message };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The assistant could not complete that.',
    };
  }
}

export async function loadConversation(
  targetKey: string,
  channel?: string,
): Promise<AssistantMessage[]> {
  return conversation(resolveTarget(targetKey), sanitiseChannel(channel));
}

export async function loadThreads(targetKey: string): Promise<ThreadSummary[]> {
  return listThreads(resolveTarget(targetKey));
}

export async function providerLabel(): Promise<{ label: string; simulated: boolean }> {
  const provider = await activeProvider();
  return { label: provider.label, simulated: provider.simulated };
}
