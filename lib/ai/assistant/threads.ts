import 'server-only';

/**
 * Conversation history and the list of named threads for a target.
 */

import { personalScope, type AssistantMessage } from '@/lib/domain';
import { readScope } from '@/lib/data/store';
import type { AssistantTarget } from '../context';
import { FOUNDER_CHANNEL } from './context-loading';

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
