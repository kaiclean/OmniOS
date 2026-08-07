import type { Metadata } from 'next';

import { activeProvider, providerStatus } from '@/lib/ai/providers';
import { CAPABILITIES, capabilityIds } from '@/lib/capabilities/registry';
import { loadSpaces } from '@/lib/data/aggregate';
import { COLLECTION_NAMES } from '@/lib/data/schema';
import { debugScopeKey, getWorkspace, readScope, storeInfo } from '@/lib/data/store';
import { sharedScope } from '@/lib/domain';
import { formatNumber, formatRelative, pluralise } from '@/lib/format';
import {
  Badge,
  Metric,
  MetricGrid,
  Note,
  PageHead,
  Panel,
  SectionHead,
} from '@/components/ui/primitives';
import { ResetWorkspace } from '@/components/settings/ResetWorkspace';
import { SettingsForm } from '@/components/settings/SettingsForm';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings.
 *
 * Half of this page is preferences; the other half answers two questions a
 * founder is entitled to ask at any moment — where is my data, and has any of it
 * left this machine. Both are read from the running system rather than described:
 * the path comes from the adapter, the provider list from the provider registry.
 */
export default async function SettingsPage() {
  const [workspace, spaces] = await Promise.all([getWorkspace(), loadSpaces()]);
  const store = storeInfo();
  const providers = await providerStatus();
  const provider = await activeProvider();

  const shared = await Promise.all(
    capabilityIds().map(async (id) => ({ id, memory: (await readScope(sharedScope(id))).memory })),
  );
  const sharedRecords = shared.reduce((sum, region) => sum + region.memory.length, 0);

  const inventory = spaces.map((space) => ({
    label: space.label,
    kind: space.kind,
    key: debugScopeKey(space.scope),
    records: COLLECTION_NAMES.reduce((sum, name) => sum + space.data[name].length, 0),
  }));
  const totalRecords = inventory.reduce((sum, entry) => sum + entry.records, 0);
  const conversationTurns = spaces.reduce((sum, space) => sum + space.data.messages.length, 0);
  const agentRuns = spaces.reduce((sum, space) => sum + space.data.agentRuns.length, 0);

  return (
    <>
      <PageHead
        eyebrow="OS"
        title="Settings"
        lede="How OmniOS looks and behaves, where your workspace physically sits, and whether anything you type is leaving this machine."
        actions={<Badge tone={provider.simulated ? 'outline' : 'accent'}>{provider.label}</Badge>}
      />

      <div className="grid">
        <Panel
          title="Appearance and behaviour"
          subtitle="Stored on the workspace root and read by the server, so a reload never flashes the previous choice"
          span={8}
        >
          <SettingsForm
            settings={workspace.settings}
            capabilities={CAPABILITIES.map((capability) => ({
              id: capability.id,
              label: capability.name,
            }))}
            providers={providers.map((provider) => ({
              id: provider.id,
              label: provider.label,
              available: provider.available,
            }))}
          />
        </Panel>

        <div className="stack span-4" style={{ gap: 'var(--s-5)' }}>
          <Panel title="Where your data lives">
            <div className="stack" style={{ gap: 'var(--s-3)' }}>
              <div className="row wrap">
                <Badge tone="outline">{store.label}</Badge>
                <span className="hint">adapter · {store.id}</span>
              </div>
              <p className="prose">
                Plain JSON files, one per scope, written atomically. You can read, back up, sync or
                delete them with a file manager; nothing here is in a database you cannot open.
              </p>
              <div className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="eyebrow">Location</span>
                <span className="mono" style={{ fontSize: 'var(--fs-small)', overflowWrap: 'anywhere' }}>
                  {store.location}
                </span>
              </div>
              <span className="hint">
                Set <span className="mono">OMNIOS_DATA_DIR</span> before starting the app to keep the
                workspace somewhere else.
              </span>
            </div>
          </Panel>

          <Panel
            title="Intelligence provider"
            subtitle="First available wins; the local one is always last and always available"
            flush
            footer={
              provider.simulated
                ? 'Nothing has left this machine. Every answer was composed here from your own records.'
                : `Your prompt and the analysis computed from your records are sent to ${provider.label}. Nothing else is.`
            }
          >
            <div className="list">
              {providers.map((entry) => (
                <div key={entry.id} className="list-row">
                  <div className="grow">
                    <div className="list-primary truncate">{entry.label}</div>
                    <div className="list-secondary">
                      {entry.simulated ? 'Runs on this machine' : 'Sends a request off this machine'}
                    </div>
                  </div>
                  <div className="list-meta">
                    {entry.id === provider.id ? (
                      <Badge tone="accent">In use</Badge>
                    ) : entry.available ? (
                      <Badge tone="outline">Available</Badge>
                    ) : (
                      <Badge tone="outline">No key</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <SectionHead
        title="Storage inventory"
        action={<Badge tone="outline">{pluralise(totalRecords + sharedRecords, 'record')}</Badge>}
      />
      <div className="grid">
        <Panel span={12} flush footer={`Workspace created ${formatRelative(workspace.createdAt)}, last written ${formatRelative(workspace.updatedAt)}.`}>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Space</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Scope key</th>
                  <th scope="col" className="num">
                    Records
                  </th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((entry) => (
                  <tr key={entry.key}>
                    <td>{entry.label}</td>
                    <td className="faint">{entry.kind}</td>
                    <td className="mono">{entry.key}</td>
                    <td className="num">{formatNumber(entry.records)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Shared capability memory</td>
                  <td className="faint">shared</td>
                  <td className="mono">
                    shared:* · {pluralise(shared.filter((r) => r.memory.length > 0).length, 'file')}
                  </td>
                  <td className="num">{formatNumber(sharedRecords)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <SectionHead title="Reset" />
      <Note tone="warn" icon="alert">
        There is one destructive action in OmniOS and this is it. It exists because the workspace
        opens with a generated sample so the system can show what it is — and the day your real
        companies are in here, that sample has to be removable in one deliberate act rather than
        deleted record by record.
      </Note>

      <div className="grid" style={{ marginTop: 'var(--s-5)' }}>
        <Panel title="Reset to an empty workspace" span={12}>
          <MetricGrid>
            <Metric label="Companies" value={formatNumber(workspace.companies.length)} hint="Each with its own scope file" />
            <Metric label="Records in spaces" value={formatNumber(totalRecords)} hint="Every collection, every space" />
            <Metric label="Shared memory" value={formatNumber(sharedRecords)} hint="Promoted and seeded lessons" />
            <Metric label="Conversation" value={formatNumber(conversationTurns)} hint={pluralise(agentRuns, 'recorded run')} />
          </MetricGrid>

          <div className="divider" />

          <ResetWorkspace
            location={store.location}
            losses={[
              {
                label: pluralise(workspace.companies.length, 'company', 'companies'),
                detail:
                  workspace.companies.map((company) => company.name).join(', ') ||
                  'No companies to delete.',
              },
              {
                label: `${pluralise(totalRecords, 'record')} across every space`,
                detail:
                  'Tasks, goals, KPIs, roadmap, finance, contacts, documents, automations and their run history, briefs, assets, health, habits, relationships, learning and calendar.',
              },
              {
                label: `${pluralise(sharedRecords, 'shared memory record')}`,
                detail:
                  'Including the lessons you promoted yourself. Shared memory is rebuilt empty, not reseeded.',
              },
              {
                label: `${pluralise(conversationTurns, 'conversation turn')} and ${pluralise(agentRuns, 'agent run')}`,
                detail: 'The whole assistant history, with every delegation plan it recorded.',
              },
              {
                label: `${pluralise(workspace.discoveries.length, 'discovery', 'discoveries')}, ${pluralise(workspace.upgrades.length, 'upgrade candidate')}, ${pluralise(workspace.reports.length, 'learning report')}`,
                detail: 'The ecosystem feed, the upgrade pipeline and every report written so far.',
              },
            ]}
            survives={[
              'Your settings — theme, motion, tint, assistant name and report cadence.',
              `Your display name, ${workspace.personal.displayName}, and an empty personal space to work in.`,
              'The storage location itself, and the adapter it uses.',
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
