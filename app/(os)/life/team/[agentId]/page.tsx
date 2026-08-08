import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { personalScope } from '@/lib/domain';
import { loadPersonalSpace } from '@/lib/data/space';
import { rosterFor } from '@/lib/ai/roster';
import { agentChannel } from '@/lib/ai/agent-chat';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';
import type { AgentChatMessage } from '@/components/agents/AgentChat';
import { AgentChat } from '@/components/agents/AgentChat';

export const metadata: Metadata = { title: 'Agent' };

/** A direct conversation with one member of the personal roster. */
export default async function LifeAgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const { personal, data } = await loadPersonalSpace();

  const roster = await rosterFor(personalScope());
  const agent = roster.find((candidate) => candidate.id === agentId);
  if (!agent) notFound();

  const channel = agentChannel(agent.id);
  const messages: AgentChatMessage[] = data.messages
    .filter((message) => message.channel === channel)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((message) => ({
      id: message.id,
      role: message.role === 'founder' ? 'user' : 'assistant',
      text: message.text,
      at: message.at,
      simulated: message.simulated,
    }));

  return (
    <>
      <PageHead
        eyebrow={`${personal.displayName} · Team`}
        title={agent.name}
        lede={agent.charter}
        actions={
          <>
            <Badge tone="outline">{agent.role}</Badge>
            <Link className="btn btn--secondary" href="/life/team">
              Back to Team
            </Link>
          </>
        }
      />
      <div className="grid">
        <Panel span={12}>
          <AgentChat
            scopeKey="personal"
            agentId={agent.id}
            agentName={agent.name}
            messages={messages}
          />
        </Panel>
      </div>
    </>
  );
}
