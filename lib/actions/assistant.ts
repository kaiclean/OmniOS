'use server';

import { revalidatePath } from 'next/cache';

import type { AssistantMessage } from '@/lib/domain';
import { parseScopeKey } from '@/lib/domain';
import type { AssistantTarget } from '@/lib/ai/context';
import { ask, conversation } from '@/lib/ai/assistant';
import { activeProvider } from '@/lib/ai/providers';

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
function resolveTarget(targetKey: string): AssistantTarget {
  if (!targetKey || targetKey === 'founder' || targetKey === 'os') return { kind: 'founder' };
  const scope = parseScopeKey(targetKey);
  if (!scope || scope.kind === 'shared') return { kind: 'founder' };
  return { kind: 'space', scope };
}

export async function askAssistant(targetKey: string, prompt: string): Promise<AssistantTurn> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, error: 'Say something first.' };
  if (trimmed.length > 4000) {
    return { ok: false, error: 'That is longer than the assistant accepts in one turn.' };
  }

  try {
    const { message } = await ask(resolveTarget(targetKey), trimmed);
    revalidatePath('/', 'layout');
    return { ok: true, message };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The assistant could not complete that.',
    };
  }
}

export async function loadConversation(targetKey: string): Promise<AssistantMessage[]> {
  return conversation(resolveTarget(targetKey));
}

export async function providerLabel(): Promise<{ label: string; simulated: boolean }> {
  const provider = await activeProvider();
  return { label: provider.label, simulated: provider.simulated };
}
