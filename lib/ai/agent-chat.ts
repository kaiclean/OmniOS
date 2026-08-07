import 'server-only';

/**
 * Direct conversations with one roster member.
 *
 * Same grounding contract as the meeting room: the reply is computed from the
 * scope's records first, filtered to the agent's capabilities, and a model only
 * phrases it. The conversation lives in the scope's `messages` collection under
 * an `agent:<id>` channel, so it persists like the assistant's history without
 * ever mixing into it.
 */

import type { AssistantMessage, Scope, SpecialistAgent } from '@/lib/domain';
import { readScope } from '@/lib/data/store';
import { briefingFor } from './meeting';
import { activeProvider } from './providers';

export function agentChannel(agentId: string): string {
  return `agent:${agentId}`;
}

export interface AgentReply {
  readonly text: string;
  readonly simulated: boolean;
  readonly providerId: string;
}

export async function directAgentReply(
  scope: Scope,
  specialist: SpecialistAgent,
  history: readonly AssistantMessage[],
  prompt: string,
  options: {
    /**
     * What the act loop did for this turn, pre-formatted. Given to the persona
     * so its words agree with what actually happened — an agent that just
     * searched and found three records must not claim there are none.
     */
    readonly activity?: string;
  } = {},
): Promise<AgentReply> {
  const data = await readScope(scope);
  const briefing = briefingFor(specialist, data);
  const provider = await activeProvider();

  if (!provider.simulated) {
    try {
      const recent = history
        .slice(-10)
        .map((message) => `${message.role === 'founder' ? 'Founder' : specialist.name}: ${message.text}`)
        .join('\n');
      const response = await provider.complete({
        messages: [
          {
            role: 'system',
            content: `You are ${specialist.name} — ${specialist.role} — in a direct working conversation with the founder inside their operating system. Your charter: ${specialist.charter}

Speak in first person, 2-6 sentences, as a trusted colleague. Ground every claim in the briefing below; when the briefing does not support a claim, say what is unknown rather than inventing it. Recommend concretely — you are here to be useful, not agreeable.

Briefing, computed from this space's real records (only your capabilities):
${briefing}`,
          },
          {
            role: 'user',
            content: `${recent ? `Recent conversation:\n${recent}\n\n` : ''}The founder says: "${prompt}".${
              options.activity
                ? `\n\nWhat you just did for this, and what each step returned. These results are fresher than your briefing — where they disagree, the results win:\n${options.activity}`
                : ''
            } Respond as ${specialist.name}.`,
          },
        ],
        maxTokens: 2048,
      });
      if (response.text.trim()) {
        return { text: response.text.trim(), simulated: false, providerId: provider.id };
      }
    } catch {
      // Fall through to the local voice — a provider failure never empties a reply.
    }
  }

  const stance = specialist.wouldDo[0] ?? specialist.charter;
  return {
    text: `From the records I can see: ${briefing.split('\n')[0] ?? 'nothing filed under my capabilities yet'}. My position, per my charter: ${stance}.`,
    simulated: true,
    providerId: provider.id,
  };
}
