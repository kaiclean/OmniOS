import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadCompanySpace } from '@/lib/data/space';
import { rosterFor } from '@/lib/ai/roster';
import { agentChannel } from '@/lib/ai/agent-chat';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';
import type { AgentChatMessage } from '@/components/agents/AgentChat';
import { AgentChat } from '@/components/agents/AgentChat';

export const metadata: Metadata = { title: 'Agent' };

/** A direct conversation with one member of the company's roster. */
export default async function CompanyAgentPage({
  params,
}: {
  params: Promise<{ companyId: string; agentId: string }>;
}) {
  const { companyId, agentId } = await params;
  const { company, data, basePath } = await loadCompanySpace(companyId);
  const scope = { kind: 'company' as const, companyId: company.id };

  const roster = await rosterFor(scope);
  const agent = roster.find((candidate) => candidate.id === agentId);
  if (!agent) notFound();

  const channel = agentChannel(agent.id);
  const messages: AgentChatMessage[] = data.messages
    .filter((message) => message.channel === channel)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
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
        eyebrow={`${company.name} · Team`}
        title={agent.name}
        lede={agent.charter}
        actions={
          <>
            <Badge tone="outline">{agent.role}</Badge>
            <Link className="btn btn--secondary" href={`${basePath}/team`}>
              Back to Team
            </Link>
          </>
        }
      />
      <div className="grid">
        <Panel span={12}>
          <AgentChat
            scopeKey={`company:${company.id}`}
            agentId={agent.id}
            agentName={agent.name}
            messages={messages}
          />
        </Panel>
      </div>
    </>
  );
}
