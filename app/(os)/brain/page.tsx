import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { CAPABILITIES, getCapability } from '@/lib/capabilities/registry';
import { loadSpaces, type SpaceView } from '@/lib/data/aggregate';
import { getWorkspace, readScope } from '@/lib/data/store';
import type { MemoryRecord, PromotionVerdict, Scope, SpecialistDomain } from '@/lib/domain';
import { SPECIALIST_DOMAINS, canRead, promotionCheck, sharedScope } from '@/lib/domain';
import { SPECIALISTS } from '@/lib/ai/specialists';
import { buildBrainGraph } from '@/lib/brain/graph';
import { BrainGraphView } from '@/components/brain/BrainGraph';
import { EMPTY, formatNumber, formatPercent, formatRelative, pluralise, titleCase } from '@/lib/format';
import {
  Badge,
  Chips,
  Empty,
  Meter,
  Metric,
  MetricGrid,
  Note,
  PageHead,
  Panel,
  SectionHead,
  SimulatedMark,
} from '@/components/ui/primitives';
import { ForgetShared } from '@/components/brain/ForgetShared';
import { PromotionGate, type PromotableRecord } from '@/components/brain/PromotionGate';

export const metadata: Metadata = { title: 'Brain' };

/**
 * The Brain — the memory model, made inspectable rather than described.
 *
 * Three regions, in the order the isolation matters: what each company knows
 * about itself, what the founder's life knows about itself, and the thin layer of
 * generalised knowledge both may read. The crossing matrix and the per-record
 * eligibility badges are computed by the same functions the store enforces at
 * runtime — `canRead` and `promotionCheck` — so this page cannot drift into
 * describing a boundary the system does not actually hold.
 */
export default async function BrainPage() {
  const [spaces, graph, { settings }] = await Promise.all([
    loadSpaces(),
    buildBrainGraph(),
    getWorkspace(),
  ]);

  const shared = await Promise.all(
    CAPABILITIES.map(async (capability) => ({
      capability,
      memory: (await readScope(sharedScope(capability.id))).memory,
    })),
  );
  const populated = shared.filter((region) => region.memory.length > 0);

  // The names a promoted lesson must not carry. Space labels are exactly the
  // company names and the founder's own name, which is what "identifies the
  // source scope" means in `promotionCheck`.
  const identifiers = spaces.map((space) => space.label);

  const scoped = spaces.flatMap((space) =>
    space.data.memory.map((record) => ({
      record,
      space,
      verdict: promotionCheck(record.text, identifiers),
    })),
  );

  const companySpaces = spaces.filter((space) => space.kind === 'company');
  const personalSpace = spaces.find((space) => space.kind === 'personal');
  const sharedRecords = shared.flatMap((region) => region.memory);
  const promotedIn = sharedRecords.filter((record) => record.promotedFromScopeKey !== undefined);
  const eligible = scoped.filter((entry) => entry.verdict.allowed && entry.record.kind !== 'fact');

  const strengths = [...scoped.map((entry) => entry.record.strength), ...sharedRecords.map((r) => r.strength)];
  const meanStrength =
    strengths.length === 0 ? null : strengths.reduce((sum, value) => sum + value, 0) / strengths.length;

  const domains = domainsInUse();

  const promotable: PromotableRecord[] = scoped.map(({ record, space, verdict }) => ({
    id: record.id,
    scopeKey: space.scopeKey,
    spaceLabel: space.label,
    capabilityId: record.capabilityId,
    capabilityName: getCapability(record.capabilityId)?.name ?? record.capabilityId,
    kind: record.kind,
    text: record.text,
    blockedBy: verdict.violations,
  }));

  return (
    <>
      <PageHead
        eyebrow="OS"
        title="Brain"
        lede="Everything OmniOS has remembered, in the three regions it keeps them in. A company's memory is readable only inside that company; your life's memory is readable only inside your life; and one thin shared layer holds the lessons that survived being stripped of who they were about."
        actions={<Badge tone="outline">{pluralise(scoped.length + sharedRecords.length, 'record')}</Badge>}
      />

      <div className="grid" style={{ marginBottom: 'var(--s-8)' }}>
        <Panel
          span={12}
          flush
          title="The living graph"
          subtitle="Every neuron is a real record; every filament a relationship that exists in the store. It grows while you watch."
          footer="Clusters take each space's hue — the one screen where the room's tint touches content, because here the hue is the data. Shared memory is the tissue between clusters."
        >
          <BrainGraphView initial={graph} reduceMotion={settings.reduceMotion} />
        </Panel>
      </div>

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <MetricGrid>
            <Metric
              label="Company memory"
              value={formatNumber(scoped.filter((e) => e.space.kind === 'company').length)}
              hint={pluralise(companySpaces.length, 'isolated space')}
            />
            <Metric
              label="Personal memory"
              value={formatNumber(personalSpace?.data.memory.length ?? 0)}
              hint="Readable by no company"
            />
            <Metric
              label="Shared memory"
              value={formatNumber(sharedRecords.length)}
              hint={`Across ${pluralise(populated.length, 'capability', 'capabilities')}`}
            />
            <Metric
              label="Promoted by you"
              value={formatNumber(promotedIn.length)}
              hint="Passed the gate below"
            />
            <Metric
              label="Eligible as written"
              value={formatNumber(eligible.length)}
              hint={`${formatNumber(scoped.length - eligible.length)} would be refused`}
            />
            <Metric
              label="Mean strength"
              value={meanStrength === null ? EMPTY : formatPercent(meanStrength * 100)}
              hint="Assigned, not measured"
            />
          </MetricGrid>
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            <SimulatedMark label="Strength assigned by OmniOS" />
          </div>
        </div>
      </section>

      <SectionHead title="What may cross, and what may not" />
      <div className="grid">
        <Panel
          title="Read access, as the store enforces it"
          subtitle="Rows read; columns are read. Computed with canRead(), the same function the loaders use."
          span={12}
          flush
          footer="Adding a company adds a row and a column, and every other company's row gains a blocked cell. Isolation is the default, not a setting."
        >
          {/* Full width rather than beside the prose: the shared columns are the
              whole point of the matrix, and at eight columns they were the first
              thing to scroll out of sight. */}
          <CrossingMatrix spaces={spaces} sharedRegions={populated.slice(0, 2)} />
        </Panel>

        <Panel title="The rule in words" span={12}>
          <dl className="two-up">
            <Rule term="May cross">
              One generalised sentence at a time, promoted by you, through the gate below. It becomes
              a new record in shared capability memory; the original never moves.
            </Rule>
            <Rule term="May never cross">
              A company name, a person, a counterparty, an amount, an email address, an IBAN, a phone
              number, a credential or a wallet address — and no company&rsquo;s records ever reach another
              company or your private life.
            </Rule>
            <Rule term="Direction">
              One-way. Shared memory is read by every space and written by none of them; a lesson
              cannot travel back down into a scope, and shared records cannot be re-promoted.
            </Rule>
            <Rule term="Who decides">
              You. Nothing in OmniOS promotes a record on its own, and the assistant cannot widen its
              own access — founder mode reads your spaces because you are the founder, not because a
              boundary was lifted.
            </Rule>
          </dl>
        </Panel>
      </div>

      <Note icon="alert">
        Strength and use count are written when a record is created and never touched again. Nothing
        here reinforces a record that proved useful or decays one that did not, because retrieval
        does not yet record a hit. Read them as the system&rsquo;s initial confidence, not as
        evidence that anything has been used.
      </Note>

      <SectionHead
        title="Per-company memory"
        action={<Badge tone="outline">{pluralise(companySpaces.length, 'company', 'companies')}</Badge>}
      />
      {companySpaces.length === 0 ? (
        <div className="grid">
          <Panel span={12}>
            <Empty title="No companies yet">
              <Link className="link-inline" href="/companies/new">
                Create one
              </Link>{' '}
              and it gets its own sealed memory region from the first record onwards.
            </Empty>
          </Panel>
        </div>
      ) : (
        <div className="grid">
          {companySpaces.map((space) => (
            <Panel
              key={space.scopeKey}
              title={space.label}
              subtitle={`${pluralise(space.data.memory.length, 'record')} · scope ${space.scopeKey}`}
              span={6}
              flush
              footer="Invisible to every other company and to personal life. There is no setting that changes this."
              action={
                <Link className="btn btn--ghost btn--sm" href={space.href}>
                  Open space
                </Link>
              }
            >
              <MemoryList entries={scoped.filter((entry) => entry.space === space)} />
            </Panel>
          ))}
        </div>
      )}

      <SectionHead title="Personal memory" />
      <div className="grid">
        <Panel
          title={personalSpace?.label ?? 'Personal'}
          subtitle={`${pluralise(personalSpace?.data.memory.length ?? 0, 'record')} · scope personal`}
          span={8}
          flush
          footer="No company reads any of this — not a company you own, and not the assistant while it is answering inside one."
        >
          <MemoryList entries={scoped.filter((entry) => entry.space.kind === 'personal')} />
        </Panel>

        <Panel title="Why this region is separate" span={4}>
          <div className="stack" style={{ gap: 'var(--s-3)' }}>
            <p className="prose">
              Personal memory is the reason the assistant can decline to stack three deep-work blocks
              on a day after five hours of sleep. It is also the region with the most that should
              never leave: how you work, what you decided about your own money, what your body did.
            </p>
            <p className="prose">
              Founder mode reads it because you asked the question yourself, at OS level. A company
              headquarters never does, in any mode.
            </p>
            <Chips items={['health', 'money', 'preferences', 'relationships']} />
          </div>
        </Panel>
      </div>

      <SectionHead
        title="Shared capability memory"
        action={<Badge tone="info">{pluralise(sharedRecords.length, 'record')}</Badge>}
      />
      <div className="grid">
        <Panel
          title="In shared memory now"
          subtitle="Read by every space that runs the capability"
          span={6}
          flush
          footer={`${pluralise(promotedIn.length, 'record')} promoted by you; the rest shipped with the workspace.`}
        >
          {populated.length === 0 ? (
            <Empty title="Nothing has been promoted">
              Shared memory starts empty and stays empty until a lesson passes the gate.
            </Empty>
          ) : (
            <div className="list">
              {populated.map((region) => (
                <div key={region.capability.id}>
                  <div className="list-group-head">
                    <span className="eyebrow">
                      {region.capability.name} · {pluralise(region.memory.length, 'record')}
                    </span>
                  </div>
                  {region.memory.map((record) => (
                    <SharedRow key={record.id} record={record} capabilityId={region.capability.id} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Promote a record to shared"
          subtitle="The gate refuses first and asks questions after"
          span={6}
          footer="Refusals are the point. A gate that lets everything through is a gate nobody should trust."
        >
          <PromotionGate records={promotable} />
        </Panel>
      </div>

      <SectionHead
        title="Specialist roster"
        action={
          <Badge tone="outline">
            {pluralise(SPECIALISTS.length, 'specialist')} · {pluralise(domains.length, 'domain')}
          </Badge>
        }
      />
      <Note icon="users">
        You never pick from this list, and there is no agent switcher anywhere in OmniOS. The router
        scores your sentence against each specialist&rsquo;s claimed phrases and delegates; the plan
        attached to every answer names who ran. The roster is here so the delegation can be audited,
        not so it can be chosen.
      </Note>

      <div className="grid" style={{ marginTop: 'var(--s-5)' }}>
        <Panel span={12} flush>
          <div className="list">
            {domains.map((domain) => (
              <div key={domain}>
                <div className="list-group-head">
                  <span className="eyebrow">
                    {titleCase(domain.replace(/-/g, ' '))} ·{' '}
                    {pluralise(SPECIALISTS.filter((s) => s.domain === domain).length, 'specialist')}
                  </span>
                </div>
                {SPECIALISTS.filter((specialist) => specialist.domain === domain).map((specialist) => (
                  <article key={specialist.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                      <div className="row wrap">
                        <span className="list-primary">{specialist.name}</span>
                        <span className="list-secondary">{specialist.role}</span>
                        {specialist.allowedScopeKinds.includes('company') ? null : (
                          <Badge tone="warn">Personal only</Badge>
                        )}
                        {specialist.allowedScopeKinds.includes('personal') ? null : (
                          <Badge tone="info">Companies only</Badge>
                        )}
                      </div>
                      <p className="hint">{specialist.charter}</p>
                      <Chips
                        items={specialist.capabilityIds.map(
                          (id) => getCapability(id)?.name ?? id,
                        )}
                      />
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- pieces --- */

/** Domains with at least one specialist, in the canonical order. */
function domainsInUse(): SpecialistDomain[] {
  return SPECIALIST_DOMAINS.filter((domain) => SPECIALISTS.some((s) => s.domain === domain));
}

function Rule({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-1)' }}>
      <dt className="eyebrow">{term}</dt>
      <dd className="hint">{children}</dd>
    </div>
  );
}

/** Who put the record there. The raw enum reads as jargon in a sentence. */
const SOURCE_LABELS: Readonly<Record<MemoryRecord['source'], string>> = {
  founder: 'recorded by you',
  assistant: 'recorded by the assistant',
  observation: 'observed from your records',
};

interface MemoryEntry {
  readonly record: MemoryRecord;
  readonly space: SpaceView;
  readonly verdict: PromotionVerdict;
}

function MemoryList({ entries }: { entries: readonly MemoryEntry[] }) {
  if (entries.length === 0) {
    return <Empty title="Nothing remembered here yet" />;
  }
  return (
    <div className="list">
      {entries.map((entry) => (
        <MemoryRow key={entry.record.id} record={entry.record} verdict={entry.verdict} />
      ))}
    </div>
  );
}

function MemoryRow({ record, verdict }: { record: MemoryRecord; verdict: PromotionVerdict }) {
  const capability = getCapability(record.capabilityId);
  return (
    <article className="list-row" style={{ alignItems: 'flex-start' }}>
      {/* Same fixed numeric column the discovery feed uses: strengths only become
          comparable when they line up as a column of digits. */}
      <div className="intel-score">
        <span className="intel-score-value">{formatPercent(record.strength * 100)}</span>
        <Meter
          value={record.strength}
          label={`Strength ${Math.round(record.strength * 100)} out of 100`}
        />
      </div>

      <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
        <span className="list-primary">{record.text}</span>
        <div className="row wrap list-secondary">
          <Badge tone="outline">{record.kind}</Badge>
          <span>{capability?.name ?? record.capabilityId}</span>
          <span aria-hidden="true">·</span>
          <span>{pluralise(record.useCount, 'use')}</span>
          <span aria-hidden="true">·</span>
          <span>{SOURCE_LABELS[record.source]}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelative(record.createdAt)}</span>
        </div>
        <span className="hint">{eligibility(record, verdict)}</span>
      </div>
    </article>
  );
}

/** Why this record could or could not leave its scope, in the founder's words. */
function eligibility(record: MemoryRecord, verdict: PromotionVerdict): string {
  if (record.kind === 'fact') {
    return 'Cannot be promoted as a fact — a fact is true of one space. Rewrite it as a lesson first.';
  }
  if (!verdict.allowed) {
    return `Would be refused: ${verdict.violations.join('; ')}.`;
  }
  return 'Passes the gate as written.';
}

function SharedRow({ record, capabilityId }: { record: MemoryRecord; capabilityId: string }) {
  return (
    <article className="list-row" style={{ alignItems: 'flex-start' }}>
      <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
        <span className="list-primary">{record.text}</span>
        <div className="row wrap list-secondary">
          <Badge tone="outline">{record.kind}</Badge>
          <span>{formatPercent(record.strength * 100)} strength</span>
          <span aria-hidden="true">·</span>
          <span>{pluralise(record.useCount, 'use')}</span>
          {record.promotedFromScopeKey ? (
            <>
              <span aria-hidden="true">·</span>
              {/* The origin key is kept but never shown as the source *text*: it
                  records that a promotion happened, not what it was about. */}
              <span>promoted from a space</span>
            </>
          ) : null}
        </div>
      </div>
      <ForgetShared capabilityId={capabilityId} recordId={record.id} />
    </article>
  );
}

/* --------------------------------------------------------------- matrix --- */

interface Axis {
  readonly key: string;
  readonly label: string;
  readonly scope: Scope;
}

function CrossingMatrix({
  spaces,
  sharedRegions,
}: {
  spaces: readonly SpaceView[];
  sharedRegions: ReadonlyArray<{ capability: { id: string; name: string } }>;
}) {
  const axis: Axis[] = [
    ...spaces.map((space) => ({ key: space.scopeKey, label: space.label, scope: space.scope })),
    ...sharedRegions.map((region) => ({
      key: `shared:${region.capability.id}`,
      label: `Shared · ${region.capability.name}`,
      scope: sharedScope(region.capability.id),
    })),
  ];

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Reading from</th>
            {axis.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axis.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                style={{
                  textTransform: 'none',
                  letterSpacing: 'normal',
                  fontSize: 'var(--fs-small)',
                  color: 'var(--text-1)',
                }}
              >
                {row.label}
              </th>
              {axis.map((column) => (
                <td key={column.key}>
                  {row.key === column.key ? (
                    <Badge tone="outline">Own records</Badge>
                  ) : canRead(row.scope, column.scope) ? (
                    <Badge tone="ok">Reads</Badge>
                  ) : (
                    <span className="faint">No access</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
