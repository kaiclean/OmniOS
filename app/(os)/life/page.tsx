import Link from 'next/link';

import { capabilitiesFor, capabilityLabel } from '@/lib/capabilities/registry';
import { ownedBy, panel } from '@/lib/capabilities/panels';
import { loadPersonalSpace } from '@/lib/data/space';
import { EMPTY, daysBetween, formatDurationMinutes, formatNumber, pluralise } from '@/lib/format';
import { deepWorkBudgetMinutes, energyLabel, energyOf } from '@/lib/personal/energy';
import { Badge, Note, PageHead, SectionHead } from '@/components/ui/primitives';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';

/**
 * Life Overview.
 *
 * The opening line is deliberately about the body rather than the calendar. A
 * founder's week is bounded by recovery long before it is bounded by hours, and
 * an operating system that plans work without seeing that plans fiction.
 */
export default async function LifeOverviewPage() {
  const { personal, data, sharedMemory, basePath } = await loadPersonalSpace();
  const capabilities = capabilitiesFor('personal', personal.disabledCapabilityIds);

  const tracked = [...data.health]
    .filter((d) => d.sleepHours !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = tracked[0];
  const energy = energyOf(latest);
  const budget = deepWorkBudgetMinutes(energy);

  const overdue = data.relationships.filter(
    (r) => r.lastContactAt && daysBetween(r.lastContactAt) > r.cadenceDays,
  );
  const openAdmin = data.lifeAdmin.filter((i) => i.status !== 'done');
  const openTasks = data.tasks.filter((t) => t.status !== 'done');

  // Each contributed panel keeps its own capability — see the company overview.
  const overviewSpecs = capabilities.flatMap((capability) =>
    (capability.overviewPanels ?? []).map((spec) => ownedBy(spec, capability.id)),
  );

  return (
    <>
      <PageHead
        eyebrow="Personal headquarters"
        title={personal.displayName}
        lede={personal.dna.identity}
        actions={
          <>
            {/* A company space offers Team and Team Room from its header; the
                personal space offered neither, so its Council and roster were
                reachable only from the command palette or by typing the URL. A
                surface nobody can find is a surface that does not exist. */}
            <Link className="btn btn--secondary" href="/life/team">
              Team
            </Link>
            <Link className="btn btn--secondary" href="/life/room">
              Council
            </Link>
            <Link className="btn btn--secondary" href="/life/dna">
              Personal DNA
            </Link>
          </>
        }
      />

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <div className="exec-row">
            <LifeStat
              label="Energy"
              value={energy === null ? EMPTY : formatNumber(energy)}
              sub={energy === null ? 'not logged' : energyLabel(energy)}
            />
            <LifeStat
              label="Deep work today"
              value={budget === null ? EMPTY : formatDurationMinutes(budget)}
              sub="honest ceiling"
            />
            <LifeStat label="Open life items" value={String(openAdmin.length)} sub="admin, travel, docs" />
            <LifeStat label="Personal tasks" value={String(openTasks.length)} sub="open" />
            <LifeStat
              label="People overdue"
              value={String(overdue.length)}
              sub={overdue[0] ? `longest: ${overdue[0].name}` : 'all current'}
            />
            <LifeStat label="Capabilities" value={String(capabilities.length)} sub="granted" />
          </div>
        </div>
      </section>

      {energy !== null && energy < 55 ? (
        <Note tone="warn" icon="alert">
          Recovery is low. Anything committed today at this level is borrowed from the rest of the
          week — the assistant has already capped the deep-work budget at{' '}
          {formatDurationMinutes(budget)}.
        </Note>
      ) : null}

      <SectionHead title="Today" />
      <CapabilityPanels
        specs={[
          ...overviewSpecs,
          panel('calendar', 'Next seven days', 6, { capabilityFilter: 'all' }),
          panel('tasks', 'Personal work', 6, { capabilityFilter: 'all', limit: 8 }),
          panel('suggestions', 'What I would change', 12, { capabilityFilter: 'all' }),
        ]}
        ctx={{
          spaceKind: 'personal',
          capabilityId: 'life-ops',
          data,
          personal,
          sharedMemory,
          basePath,
        }}
      />

      <SectionHead
        title="Life capabilities"
        action={<span className="hint">{pluralise(capabilities.length, 'platform')}, same engine as a company</span>}
      />
      <div className="capability-grid">
        {capabilities.map((capability) => (
          <Link key={capability.id} className="panel card-link" href={`/life/${capability.id}`}>
            <div className="panel-body stack" style={{ gap: 'var(--s-2)' }}>
              <span className="eyebrow">{capability.group}</span>
              <span className="panel-title">{capabilityLabel(capability, 'personal')}</span>
              <span className="hint">{capability.tagline}</span>
            </div>
          </Link>
        ))}
      </div>

      <SectionHead title="Non-negotiables" />
      <div className="chip-row">
        {personal.dna.nonNegotiables.map((rule) => (
          <Badge key={rule} tone="warn">
            {rule}
          </Badge>
        ))}
      </div>
    </>
  );
}

function LifeStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-1)' }}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="hint">{sub}</span>
    </div>
  );
}
