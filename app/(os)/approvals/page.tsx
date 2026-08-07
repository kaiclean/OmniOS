import type { Metadata } from 'next';
import Link from 'next/link';

import { listGrants } from '@/lib/actions/grants';
import { pendingApprovals, recentDecisions } from '@/lib/actions/tools';
import { GrantRow } from '@/components/approvals/GrantRow';
import { EMPTY, formatNumber, formatRelative, pluralise } from '@/lib/format';
import {
  Badge,
  Empty,
  Metric,
  MetricGrid,
  Note,
  PageHead,
  Panel,
  SectionHead,
} from '@/components/ui/primitives';
import { ApprovalRow } from '@/components/approvals/ApprovalRow';

export const metadata: Metadata = { title: 'Approvals' };

/**
 * The approvals inbox.
 *
 * Invariant 2 says nothing applies itself. This page is where that stops being a
 * refusal and becomes a workflow: everything the system wanted to do and could
 * not, in one place, each with the preview that was computed before it was
 * queued.
 *
 * It aggregates across spaces, which is allowed here and nowhere near an agent —
 * this is the founder's own inbox, assembled for their own question.
 */
export default async function ApprovalsPage() {
  const [pending, decided, grants] = await Promise.all([
    pendingApprovals(),
    recentDecisions(),
    listGrants(),
  ]);
  const activeGrants = grants.filter((entry) => entry.active).length;

  const external = pending.filter((entry) => entry.call.risk === 'external').length;
  const destructive = pending.filter((entry) => entry.call.risk === 'destructive').length;
  const executed = decided.filter((entry) => entry.call.status === 'executed').length;
  const rejected = decided.filter((entry) => entry.call.status === 'rejected').length;
  const oldest = pending[pending.length - 1];

  return (
    <>
      <PageHead
        eyebrow="OS"
        title="Approvals"
        lede="Everything OmniOS prepared and stopped on. Each row shows exactly what would happen, worked out before it was queued rather than described afterwards."
        actions={
          <Badge tone={pending.length > 0 ? 'warn' : 'outline'}>
            {pending.length > 0 ? `${pluralise(pending.length, 'decision')} waiting` : 'Nothing waiting'}
          </Badge>
        }
      />

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <MetricGrid>
            <Metric label="Waiting on you" value={formatNumber(pending.length)} hint="Across every space you own" />
            <Metric
              label="Reaches outside"
              value={pending.length === 0 ? EMPTY : formatNumber(external)}
              hint="Sending, publishing, paying or calling a third party"
            />
            <Metric
              label="Deletes something"
              value={pending.length === 0 ? EMPTY : formatNumber(destructive)}
              hint="Cannot be recovered from inside OmniOS"
            />
            <Metric
              label="Oldest"
              value={oldest ? formatRelative(oldest.call.at) : EMPTY}
              hint={oldest ? oldest.spaceLabel : 'Nothing queued'}
            />
            <Metric
              label="Approved and run"
              value={decided.length === 0 ? EMPTY : formatNumber(executed)}
              hint="Recently"
            />
            <Metric
              label="Rejected"
              value={decided.length === 0 ? EMPTY : formatNumber(rejected)}
              hint="Kept as evidence, not deleted"
            />
          </MetricGrid>
        </div>
      </section>

      <SectionHead title="Waiting on you" />
      <div className="grid">
        <Panel
          span={12}
          flush
          footer="Approving records who decided and when, and only then runs the call. Nothing here can run itself."
        >
          {pending.length === 0 ? (
            <Empty title="Nothing is waiting">
              A call lands here when its risk tier stops it: anything that deletes, and anything that
              reaches outside OmniOS through a connection. Reading and writing your own records
              never queues — it just happens.
            </Empty>
          ) : (
            <div className="list">
              {pending.map((entry) => (
                <ApprovalRow
                  key={entry.call.id}
                  call={entry.call}
                  {...(entry.toolLabel ? { toolLabel: entry.toolLabel } : {})}
                  spaceLabel={entry.spaceLabel}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {pending.some((entry) => !entry.toolLabel) ? (
        <Note tone="warn" icon="alert">
          One or more of these name a tool that is no longer available — usually a connection that
          was removed or switched off after the call was queued. Approving it will fail rather than
          run something unexpected. Reject it, or restore the connection on{' '}
          <Link href="/connections">Connections</Link>.
        </Note>
      ) : null}

      <SectionHead
        title="Standing grants"
        action={<Badge tone={activeGrants > 0 ? 'warn' : 'outline'}>{pluralise(activeGrants, 'active grant')}</Badge>}
      />
      <div className="grid">
        <Panel
          span={12}
          flush
          footer="A grant is your approval recorded in advance: one tool, one connection, one space, optionally until a date. Calls made under it stay in the record naming it. Deleting or resetting inside OmniOS can never be granted — those are decided per call, always."
        >
          {grants.length === 0 ? (
            <Empty title="Nothing runs without asking">
              Every external call waits for you. When one keeps coming back and you trust it, approve
              it with “allow for a week” and its exact shape gains a standing grant you can revoke
              here.
            </Empty>
          ) : (
            <div className="list">
              {grants.map((entry) => (
                <GrantRow
                  key={entry.grant.id}
                  grant={entry.grant}
                  active={entry.active}
                  serverName={entry.serverName}
                  spaceLabel={entry.spaceLabel}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <SectionHead title="Recently decided" />
      <div className="grid">
        <Panel span={12} flush footer="Rejections are kept. What the system tried to do is part of the record.">
          {decided.length === 0 ? (
            <Empty title="Nothing decided yet">
              Once you approve or reject something, it stays here with what actually happened.
            </Empty>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Tool</th>
                    <th scope="col">Space</th>
                    <th scope="col">Risk</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Decided</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.map((entry) => (
                    <tr key={entry.call.id}>
                      <td>{entry.toolLabel ?? entry.call.toolId}</td>
                      <td className="faint">{entry.spaceLabel}</td>
                      <td className="faint">{entry.call.risk}</td>
                      <td>
                        {entry.call.status === 'executed'
                          ? (entry.call.result ?? 'Done.')
                          : entry.call.status === 'rejected'
                            ? 'Rejected. Nothing ran.'
                            : (entry.call.error ?? entry.call.status)}
                      </td>
                      <td className="faint">
                        {entry.call.decidedAt ? formatRelative(entry.call.decidedAt) : formatRelative(entry.call.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
