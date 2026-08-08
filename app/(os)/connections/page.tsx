import type { Metadata } from 'next';

import { providerStatus } from '@/lib/ai/providers';
import { mcpToolDefinitions } from '@/lib/ai/tools/mcp-bridge';
import { readVaultView } from '@/lib/actions/secrets';
import { CAPABILITIES } from '@/lib/capabilities/registry';
import { getWorkspace } from '@/lib/data/store';
import type { CatalogEntry, ConnectorState } from '@/lib/domain';
import {
  CONNECTOR_CATALOG,
  CONNECTOR_CATEGORIES,
  CONNECTOR_CATEGORY_LABELS,
  CONNECTOR_STATE_LABELS,
  referencedSecretNames,
  requiresApproval,
} from '@/lib/domain';
import type { WorkspaceRoot } from '@/lib/data/schema';

/**
 * A catalog card's state is derived from what is actually configured, never
 * asserted. AI entries check the provider registry; everything else checks the
 * connections themselves — a server whose last probe failed shows as failing.
 */
function catalogState(
  entry: CatalogEntry,
  workspace: WorkspaceRoot,
  providers: ReadonlyArray<{ id: string; available: boolean }>,
): ConnectorState {
  if (entry.category === 'ai' && !entry.presetId) {
    const providerId =
      entry.id === 'ollama-cloud' ? 'ollama' : entry.id === 'anthropic' ? 'anthropic' : 'openai';
    return providers.find((p) => p.id === providerId)?.available ? 'connected' : 'needs-key';
  }
  const server = entry.presetId
    ? workspace.mcpServers.find(
        (candidate) => candidate.id === entry.presetId || candidate.id.startsWith(`${entry.presetId}-`),
      )
    : undefined;
  if (server) {
    const state = workspace.mcpStates.find((candidate) => candidate.serverId === server.id);
    if (state?.status === 'connected') return 'connected';
    if (state?.status === 'error' || server.lastError) return 'error';
    return 'configured';
  }
  return entry.presetId ? 'one-click' : 'needs-server';
}
import { EMPTY, formatNumber, pluralise } from '@/lib/format';
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
import { AddConnection } from '@/components/connections/AddConnection';
import { ConnectionCard } from '@/components/connections/ConnectionCard';
import { PresetPicker } from '@/components/connections/PresetPicker';
import { TelegramPanel } from '@/components/connections/TelegramPanel';
import { SecretsPanel } from '@/components/connections/SecretsPanel';

export const metadata: Metadata = { title: 'Connections' };

/**
 * Connections.
 *
 * One page for everything that reaches outside this workspace: the MCP servers
 * OmniOS can call, and the credentials it holds for them. They belong together
 * because they are one decision — what this system is allowed to touch, and with
 * whose authority.
 *
 * Nothing here connects while the page renders. Every server shows the result of
 * the last time it was asked, with the time it was asked, so the page is honest
 * about the difference between "worked" and "works".
 */
export default async function ConnectionsPage() {
  const [workspace, vault, providers] = await Promise.all([
    getWorkspace(),
    readVaultView(),
    providerStatus(),
  ]);

  const capabilities = CAPABILITIES.map((capability) => ({
    id: capability.id,
    label: capability.name,
  }));

  const servers = [...workspace.mcpServers].sort((a, b) => a.name.localeCompare(b.name));
  const stateFor = (id: string) => workspace.mcpStates.find((state) => state.serverId === id);

  const bridged = mcpToolDefinitions(workspace.mcpServers, workspace.mcpStates);
  const gatedTools = bridged.filter((tool) => requiresApproval(tool.risk)).length;
  const connected = servers.filter((server) => stateFor(server.id)?.status === 'connected' && server.enabled);

  // What the workspace is already asking for, so the founder is not left guessing
  // which name a placeholder expects. Providers appear here too: a key is a key.
  const wanted = new Map<string, string>();
  for (const provider of providers) {
    if (provider.keyName && !provider.available) wanted.set(provider.keyName, `${provider.label} as the intelligence provider`);
  }
  for (const server of workspace.mcpServers) {
    for (const value of [...Object.values(server.env ?? {}), ...Object.values(server.headers ?? {})]) {
      for (const secretName of referencedSecretNames(value)) {
        wanted.set(secretName, `the ${server.name} connection`);
      }
    }
  }
  const suggestions = [...wanted].map(([name, wantedBy]) => ({ name, wantedBy }));

  return (
    <>
      <PageHead
        eyebrow="OS"
        title="Connections"
        lede="Everything OmniOS can reach beyond this workspace arrives through here. One door, one lock: a tool from a connection is validated, previewed and gated exactly like a built-in, and by default it waits for you."
        actions={
          <Badge tone={connected.length > 0 ? 'accent' : 'outline'}>
            {connected.length > 0 ? `${pluralise(connected.length, 'connection')} live` : 'Nothing connected'}
          </Badge>
        }
      />

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <MetricGrid>
            <Metric
              label="Connections"
              value={formatNumber(servers.length)}
              hint={`${formatNumber(servers.filter((s) => s.enabled).length)} enabled`}
            />
            <Metric
              label="Reached successfully"
              value={servers.length === 0 ? EMPTY : formatNumber(connected.length)}
              hint="At the time each was last asked"
            />
            <Metric
              label="Tools available"
              value={bridged.length === 0 ? EMPTY : formatNumber(bridged.length)}
              hint="From connected servers, minus the ones you switched off"
            />
            <Metric
              label="Waiting on you"
              value={bridged.length === 0 ? EMPTY : `${formatNumber(gatedTools)}/${formatNumber(bridged.length)}`}
              hint="Tools that stop for a decision before running"
            />
            <Metric
              label="Secrets stored"
              value={formatNumber(vault.secrets.length)}
              hint={`Encrypted with ${vault.algorithm}`}
            />
            <Metric
              label="Credentials asked for"
              value={suggestions.length === 0 ? EMPTY : formatNumber(suggestions.length)}
              hint="Named by a connection or a provider"
            />
          </MetricGrid>
        </div>
      </section>

      <Note tone="warn" icon="alert">
        A local connection starts a program on this machine and talks to it. That is the same trust
        you extend by running any command in a terminal, and it is worth being deliberate about:
        only add one whose command you recognise, and read what a preset fills in before you enable
        it. A remote connection sends the arguments of each call to whoever operates that URL.
      </Note>

      <SectionHead
        title="Your connections"
        action={<AddConnection capabilities={capabilities} defaultAutonomy={workspace.settings.defaultMcpAutonomy} />}
      />

      {servers.length === 0 ? (
        <div className="grid">
          <Panel span={12}>
            <Empty title="Nothing connected yet">
              Until something is here, OmniOS can only read and write its own records. That is a
              complete system on its own — the assistant plans, drafts and tracks without any of
              this. Connections are what let it act on the outside world, and each one is a
              deliberate grant.
            </Empty>
          </Panel>
        </div>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-5)' }}>
          {servers.map((server) => (
            <ConnectionCard
              key={server.id}
              server={server}
              {...(stateFor(server.id) ? { state: stateFor(server.id)! } : {})}
              capabilities={capabilities}
              defaultAutonomy={workspace.settings.defaultMcpAutonomy}
            />
          ))}
        </div>
      )}

      <SectionHead title="What OmniOS can reach" />
      <Note icon="panel">
        A map, not an inventory: every service below arrives the same way — as an MCP server on
        this page, through the same gate. Entries with a preset connect in one click; the rest say
        honestly what they need. Nothing here can look connected when it is not.
      </Note>
      <div className="grid" style={{ marginTop: 'var(--s-5)' }}>
        {CONNECTOR_CATEGORIES.map((category) => {
          const entries = CONNECTOR_CATALOG.filter((entry) => entry.category === category);
          return (
            <Panel key={category} span={6} flush title={CONNECTOR_CATEGORY_LABELS[category]}>
              <div className="list">
                {entries.map((entry) => {
                  const state = catalogState(entry, workspace, providers);
                  return (
                    <div key={entry.id} className="list-row">
                      <div className="grow">
                        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
                          <span className="list-primary">{entry.name}</span>
                          <Badge tone={state === 'connected' ? 'accent' : state === 'error' ? 'warn' : 'outline'}>
                            {CONNECTOR_STATE_LABELS[state]}
                          </Badge>
                        </div>
                        <div className="list-secondary">
                          {entry.unlocks}{' '}
                          {state === 'needs-server' || state === 'one-click' || state === 'needs-key' ? entry.how : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          );
        })}
      </div>

      <SectionHead title="Start from a preset" />
      <div className="grid">
        <Panel
          span={12}
          flush
          footer="Each of these is an MCP server maintained by someone else. OmniOS writes the configuration; installing and trusting the server is your decision."
        >
          <PresetPicker existingIds={workspace.mcpServers.map((server) => server.id)} />
        </Panel>
      </div>

      <SectionHead title="Approvals on your phone" />
      <div className="grid">
        <Panel
          span={8}
          title="Telegram"
          subtitle="A second door onto the approvals inbox — signed, bound to one chat, and through the same gate"
        >
          <TelegramPanel
            config={workspace.telegram}
            tokenStored={vault.secrets.some((secret) => secret.name === 'TELEGRAM_BOT_TOKEN')}
            webhookSecretSet={Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim())}
          />
        </Panel>
      </div>

      <SectionHead
        title="Keys and secrets"
        action={<Badge tone="outline">{pluralise(vault.secrets.length, 'secret')}</Badge>}
      />
      <div className="grid">
        <Panel
          span={8}
          title="The vault"
          subtitle="One way in, one way out — a value is written here and read only inside the call that needs it"
        >
          <SecretsPanel
            secrets={vault.secrets}
            suggestions={suggestions}
            keySource={vault.keySource}
            location={vault.location}
            algorithm={vault.algorithm}
          />
        </Panel>

        <div className="stack span-4" style={{ gap: 'var(--s-5)' }}>
          <Panel
            title="Intelligence providers"
            subtitle="A key stored here is picked up on the next request — no restart, no dotfile"
            flush
          >
            <div className="list">
              {providers.map((provider) => (
                <div key={provider.id} className="list-row">
                  <div className="grow">
                    <div className="list-primary truncate">{provider.label}</div>
                    <div className="list-secondary">
                      {provider.keyName ? (
                        <span className="mono">{provider.keyName}</span>
                      ) : (
                        'Runs on this machine'
                      )}
                    </div>
                  </div>
                  <div className="list-meta">
                    <Badge tone={provider.available ? 'accent' : 'outline'}>
                      {provider.available ? 'Available' : 'No key'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="How a remote tool is treated">
            <div className="stack" style={{ gap: 'var(--s-3)' }}>
              <p className="prose">
                A tool a server advertises becomes an ordinary tool inside OmniOS: same argument
                validation, same written preview of exactly what a call would do, same approval
                gate. It is namespaced, so nothing a server offers can shadow a built-in.
              </p>
              <p className="prose">
                By default every remote call is treated as reaching outside, which means it stops
                and waits. You can loosen that per connection, and a connection set to run without
                asking says so on its card and in every plan that uses it.
              </p>
              <p className="prose">
                Deleting and reaching outside always require a recorded decision. There is no
                setting anywhere in OmniOS that changes that.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
