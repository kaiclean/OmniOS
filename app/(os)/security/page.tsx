import type { Metadata } from 'next';
import Link from 'next/link';

import { acrossSpaces, loadSpaces } from '@/lib/data/aggregate';
import { getWorkspace } from '@/lib/data/store';
import { listGrants } from '@/lib/actions/grants';
import { listSecrets } from '@/lib/secrets/vault';
import { RISK_EXPLANATION, RISK_TIERS, connectionStatusFor, grantActive } from '@/lib/domain';
import { EMPTY, formatNumber, formatRelative, pluralise } from '@/lib/format';
import {
  Badge,
  Empty,
  ListRow,
  Metric,
  MetricGrid,
  Note,
  PageHead,
  Panel,
  SectionHead,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Security Center' };

/**
 * The trust story, in one place and in plain language. Everything here is
 * derived from the same records the rest of the OS runs on — this page holds
 * no switches of its own, because a security page that can change security is
 * an attack surface, not an audit.
 */
export default async function SecurityPage() {
  const [workspace, spaces, grants, secrets] = await Promise.all([
    getWorkspace(),
    loadSpaces(),
    listGrants(),
    listSecrets(),
  ]);
  const now = new Date();

  const calls = acrossSpaces(spaces, 'toolCalls');
  const decided = calls
    .filter(({ item }) => item.decidedBy !== undefined)
    .sort((a, b) => ((a.item.decidedAt ?? '') < (b.item.decidedAt ?? '') ? 1 : -1));
  const approved = decided.filter(({ item }) => item.status !== 'rejected').length;
  const rejected = decided.filter(({ item }) => item.status === 'rejected').length;
  const pending = calls.filter(({ item }) => item.status === 'awaiting-approval').length;
  const underGrant = calls.filter(({ item }) => item.grantId !== undefined).length;
  const activeGrants = workspace.grants.filter((grant) => grantActive(grant, now));
  const remoteDeciders = new Set(
    decided
      .map(({ item }) => item.decidedBy ?? '')
      .filter((decider) => decider.startsWith('telegram:')),
  );

  return (
    <>
      <PageHead
        eyebrow="OS"
        title="Security Center"
        lede="What may run on its own, what must wait for you, who has decided what, and where the keys live. Everything on this page is read from the records — there is nothing here to switch, and that is the point."
        actions={
          <Badge tone={pending > 0 ? 'warn' : 'outline'}>
            {pending > 0 ? `${pluralise(pending, 'decision')} waiting` : 'Nothing waiting'}
          </Badge>
        }
      />

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <MetricGrid>
            <Metric
              label="Decisions recorded"
              value={decided.length === 0 ? EMPTY : formatNumber(decided.length)}
              hint={`${formatNumber(approved)} approved · ${formatNumber(rejected)} rejected`}
            />
            <Metric
              label="Waiting on you"
              value={pending === 0 ? EMPTY : formatNumber(pending)}
              hint="Queued at the gate right now"
            />
            <Metric
              label="Standing grants"
              value={activeGrants.length === 0 ? EMPTY : formatNumber(activeGrants.length)}
              hint={`${pluralise(underGrant, 'call')} ran under one, each naming it`}
            />
            <Metric
              label="Connections"
              value={workspace.mcpServers.length === 0 ? EMPTY : formatNumber(workspace.mcpServers.length)}
              hint={`${workspace.mcpStates.filter((s) => s.status === 'connected').length} reachable`}
            />
            <Metric
              label="Keys in the vault"
              value={secrets.length === 0 ? EMPTY : formatNumber(secrets.length)}
              hint="Encrypted at rest · plaintext only inside an executor"
            />
            <Metric
              label="Phone approvals"
              value={workspace.telegram.enabled ? 'On' : EMPTY}
              hint={
                workspace.telegram.enabled
                  ? `${remoteDeciders.size > 0 ? `${remoteDeciders.size} remote decider(s) recorded` : 'No remote decisions yet'}`
                  : 'Telegram not connected'
              }
            />
            <Metric
              label="Access key"
              value={process.env.OMNIOS_ACCESS_KEY ? 'Set' : EMPTY}
              hint={
                process.env.OMNIOS_ACCESS_KEY
                  ? 'Every page and API requires a session'
                  : 'Local-only — set OMNIOS_ACCESS_KEY before any tunnel'
              }
            />
            <Metric
              label="Last heartbeat"
              value={workspace.lastHeartbeatAt ? formatRelative(workspace.lastHeartbeatAt) : EMPTY}
              hint="The 12-hour check proving the tunnel and server are alive"
            />
          </MetricGrid>
        </div>
      </section>

      <SectionHead title="The gate" />
      <div className="grid">
        <Panel
          span={8}
          flush
          footer={
            workspace.settings.confirmWrites
              ? 'Confirm-writes is on: even reversible writes wait for you. This knob only ever tightens.'
              : 'Reads and reversible writes run on their own. Anything destructive or outward always waits.'
          }
        >
          <div className="list">
            {RISK_TIERS.map((tier) => (
              <ListRow
                key={tier}
                primary={tier}
                secondary={RISK_EXPLANATION[tier]}
                trailing={
                  <Badge
                    tone={
                      tier === 'destructive' || tier === 'external'
                        ? 'warn'
                        : tier === 'write' && workspace.settings.confirmWrites
                          ? 'warn'
                          : 'ok'
                    }
                  >
                    {tier === 'destructive' || tier === 'external'
                      ? 'always waits'
                      : tier === 'write' && workspace.settings.confirmWrites
                        ? 'waits (your setting)'
                        : 'autonomous'}
                  </Badge>
                }
              />
            ))}
          </div>
        </Panel>

        <Panel
          title="What can never happen"
          span={4}
          flush
          footer="These are structural, pinned by tests — not settings."
        >
          <div className="list">
            <ListRow primary="A gated call running itself" secondary="The executor consults the risk tier, not the caller. There is no bypass parameter." />
            <ListRow primary="A grant covering a built-in tool" secondary="Grants reach only connection tools. Deleting inside OmniOS is decided per call, forever." />
            <ListRow primary="An agent acting outside its charter" secondary="A hired agent's loop is only offered tools of its ticked capabilities. Narrowing has no widening counterpart." />
            <ListRow primary="A secret reaching a record or a model" secondary="Plaintext exists only inside an executor for the duration of a call. The composer refuses pasted credentials." />
            <ListRow primary="One space reading another" secondary="Every store read names a scope. Aggregation exists only on founder-facing pages like this one." />
          </div>
        </Panel>
      </div>

      <SectionHead title="Who decided what" action={<Link className="btn btn--secondary btn--sm" href="/approvals">Approvals</Link>} />
      <div className="grid">
        <Panel span={12} flush footer="Rejections are kept as evidence. A decision made from Telegram names the chat and the pressing user.">
          {decided.length === 0 ? (
            <Empty title="No decisions recorded yet">
              The first time something stops at the gate and you decide it, the decision is recorded
              here — who, when, and what ran or did not.
            </Empty>
          ) : (
            <div className="list">
              {decided.slice(0, 10).map(({ item, space }) => (
                <ListRow
                  key={item.id}
                  primary={item.preview}
                  secondary={`${space.label} · decided by ${item.decidedBy}${item.grantId ? ' · under a standing grant' : ''}`}
                  meta={item.decidedAt ? formatRelative(item.decidedAt) : EMPTY}
                  trailing={
                    <Badge tone={item.status === 'rejected' ? 'neutral' : 'ok'}>
                      {item.status === 'rejected' ? 'rejected' : 'approved'}
                    </Badge>
                  }
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <SectionHead title="Connections and their reach" action={<Link className="btn btn--secondary btn--sm" href="/connections">Connections</Link>} />
      <div className="grid">
        <Panel
          span={12}
          flush
          footer="A connection's autonomy decides how its tools are tiered — and a tool's tier decides whether it waits. Grants are visible and revocable under Approvals."
        >
          {workspace.mcpServers.length === 0 ? (
            <Empty title="Nothing reaches outside">
              No MCP servers are connected, so the assistant cannot browse, send, publish or touch
              any third-party service. That is a fact of configuration, not a promise.
            </Empty>
          ) : (
            <div className="list">
              {workspace.mcpServers.map((server) => {
                const state = workspace.mcpStates.find((candidate) => candidate.serverId === server.id);
                const serverGrants = grants.filter(
                  (entry) => entry.grant.serverId === server.id && entry.active,
                ).length;
                // Derived, not the raw stored token — the same status the
                // Connections page shows, so the two pages cannot disagree.
                // A tool count is only a fact once a connect succeeded; before
                // that it is absence, and absence is an em dash, not a zero.
                const status = connectionStatusFor(server, state);
                const toolCount =
                  status === 'connected' ? `${state?.tools.length ?? 0} tools` : `${EMPTY} tools`;
                return (
                  <ListRow
                    key={server.id}
                    primary={server.name}
                    secondary={`autonomy: ${server.autonomy} · ${toolCount} · ${pluralise(serverGrants, 'active grant')}`}
                    trailing={
                      <Badge
                        tone={
                          status === 'connected'
                            ? 'ok'
                            : status === 'error' || status === 'needs-setup'
                              ? 'deny'
                              : 'outline'
                        }
                      >
                        {status === 'needs-setup' ? 'needs setup' : status.replace('-', ' ')}
                      </Badge>
                    }
                  />
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <Note icon="shield">
        The vault&apos;s threat model, stated plainly: keys are encrypted at rest with a machine-local
        key, decrypted only inside a tool executor for the duration of one call, and never written to
        a record, a log, a page, or a model prompt. What this does not protect against: someone with
        full access to this machine&apos;s filesystem and memory. If that is your threat, use
        per-service revocable keys and rotate them.
      </Note>
    </>
  );
}
