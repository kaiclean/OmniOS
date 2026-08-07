import type { Metadata } from 'next';
import Link from 'next/link';

import { acrossSpaces, buildTimeline, loadSpaces } from '@/lib/data/aggregate';
import { getWorkspace } from '@/lib/data/store';
import { grantActive } from '@/lib/domain';
import { EMPTY, formatNumber, formatRelative, pluralise } from '@/lib/format';
import { TimelineList } from '@/components/timeline/TimelineList';
import {
  Badge,
  Empty,
  ListRow,
  Metric,
  MetricGrid,
  PageHead,
  Panel,
  SectionHead,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Mission Control' };

/**
 * One pane for the question "what is my OS doing, and what does it need from
 * me?" — assembled from records that already exist, so it can never disagree
 * with the spaces it summarises. This is founder-level aggregation, which is
 * allowed here and never inside an agent.
 */
export default async function MissionControlPage() {
  const [workspace, spaces] = await Promise.all([getWorkspace(), loadSpaces()]);
  const now = new Date();

  const pendingCalls = acrossSpaces(spaces, 'toolCalls').filter(
    (entry) => entry.item.status === 'awaiting-approval',
  );
  const liveMeetings = acrossSpaces(spaces, 'meetings').filter(
    (entry) => entry.item.stage === 'in-session' || entry.item.stage === 'plan-ready',
  );
  const planReady = liveMeetings.filter((entry) => entry.item.stage === 'plan-ready');
  const upgradesAwaiting = workspace.upgrades.filter((u) => u.stage === 'awaiting-approval');
  const armed = acrossSpaces(spaces, 'automations').filter((entry) => entry.item.status === 'armed');
  const activeGrants = workspace.grants.filter((grant) => grantActive(grant, now));
  const liveConnections = workspace.mcpStates.filter((state) => state.status === 'connected');

  const decisionsWaiting = pendingCalls.length + upgradesAwaiting.length + planReady.length;
  // Reads stay on the full timeline; the digest shows what changed or waits.
  const recent = buildTimeline(spaces, workspace, { limit: 80 })
    .filter((event) => !event.readOnly)
    .slice(0, 14);

  return (
    <>
      <PageHead
        eyebrow="OS"
        title="Mission Control"
        lede="Everything the OS is doing across every space — what ran, what is in the room, and what stopped to wait for you. Assembled from the records themselves, so it cannot drift from the truth."
        actions={
          <Badge tone={decisionsWaiting > 0 ? 'warn' : 'outline'}>
            {decisionsWaiting > 0 ? `${pluralise(decisionsWaiting, 'decision')} waiting` : 'Nothing waiting'}
          </Badge>
        }
      />

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <MetricGrid>
            <Metric
              label="Waiting on you"
              value={decisionsWaiting === 0 ? EMPTY : formatNumber(decisionsWaiting)}
              hint="Approvals, upgrades and meeting plans"
            />
            <Metric
              label="Meetings live"
              value={liveMeetings.length === 0 ? EMPTY : formatNumber(liveMeetings.length)}
              hint="Rooms in session or holding a drafted plan"
            />
            <Metric
              label="Automations armed"
              value={armed.length === 0 ? EMPTY : formatNumber(armed.length)}
              hint="Across every space"
            />
            <Metric
              label="Standing grants"
              value={activeGrants.length === 0 ? EMPTY : formatNumber(activeGrants.length)}
              hint="Approvals recorded in advance, revocable"
            />
            <Metric
              label="Connections live"
              value={liveConnections.length === 0 ? EMPTY : formatNumber(liveConnections.length)}
              hint={`Of ${pluralise(workspace.mcpServers.length, 'configured server')}`}
            />
          </MetricGrid>
        </div>
      </section>

      <div className="grid">
        <Panel
          title="Needs your decision"
          subtitle="Everything the OS prepared and stopped on, everywhere"
          span={8}
          flush
          footer="Nothing here can run itself. Each row goes to where the decision is made."
        >
          {decisionsWaiting === 0 ? (
            <Empty title="Nothing waits on you">
              Gated calls, drafted meeting plans and measured upgrades all land here the moment they
              need a human.
            </Empty>
          ) : (
            <div className="list">
              {pendingCalls.slice(0, 6).map(({ item, space }) => (
                <ListRow
                  key={item.id}
                  primary={<Link href="/approvals">{item.preview}</Link>}
                  secondary={`${space.label} · queued ${formatRelative(item.at)}`}
                  trailing={<Badge tone={item.risk === 'destructive' ? 'deny' : 'warn'}>{item.risk}</Badge>}
                />
              ))}
              {planReady.map(({ item, space }) => (
                <ListRow
                  key={item.id}
                  primary={
                    <Link href={space.kind === 'company' ? `${space.href}/room` : '/life/room'}>
                      Plan ready — “{item.topic}”
                    </Link>
                  }
                  secondary={`${space.label} · ${pluralise(item.plan?.tasks.length ?? 0, 'task')} on approval`}
                  trailing={<Badge tone="warn">meeting</Badge>}
                />
              ))}
              {upgradesAwaiting.map((upgrade) => (
                <ListRow
                  key={upgrade.id}
                  primary={<Link href="/intelligence/upgrades">{upgrade.title}</Link>}
                  secondary="Sandboxed and measured — your call"
                  trailing={<Badge tone="warn">upgrade</Badge>}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Live now"
          subtitle="Rooms in session and work that runs itself"
          span={4}
          flush
        >
          {liveMeetings.length === 0 && armed.length === 0 ? (
            <Empty title="All quiet">
              Open a Team Room or arm an automation and it appears here while it is alive.
            </Empty>
          ) : (
            <div className="list">
              {liveMeetings.map(({ item, space }) => (
                <ListRow
                  key={item.id}
                  primary={
                    <Link href={space.kind === 'company' ? `${space.href}/room` : '/life/room'}>
                      “{item.topic}”
                    </Link>
                  }
                  secondary={`${space.label} · ${pluralise(item.participantIds.length, 'specialist')} seated`}
                  trailing={
                    <Badge tone={item.stage === 'plan-ready' ? 'warn' : 'accent'}>{item.stage}</Badge>
                  }
                />
              ))}
              {armed.slice(0, 5).map(({ item, space }) => (
                <ListRow
                  key={item.id}
                  primary={<Link href="/automations">{item.name}</Link>}
                  secondary={`${space.label} · ${item.lastRunAt ? `last ran ${formatRelative(item.lastRunAt)}` : 'not run yet'}`}
                  trailing={<Badge tone="outline">armed</Badge>}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <SectionHead
        title="Recent activity"
        action={
          <Link className="btn btn--secondary btn--sm" href="/timeline">
            Full timeline
          </Link>
        }
      />
      <div className="grid">
        <Panel span={12} flush footer="A projection of the records themselves — there is no second history to fall out of date.">
          <TimelineList events={recent} />
        </Panel>
      </div>
    </>
  );
}
