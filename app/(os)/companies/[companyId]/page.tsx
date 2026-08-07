import Link from 'next/link';

import { capabilitiesFor, capabilityLabel } from '@/lib/capabilities/registry';
import { ownedBy, panel } from '@/lib/capabilities/panels';
import { loadCompanySpace } from '@/lib/data/space';
import { formatDurationMinutes, formatMinorAmount, pluralise } from '@/lib/format';
import { Badge, PageHead, Panel, SectionHead } from '@/components/ui/primitives';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';
import { LaunchProgram } from '@/components/company/LaunchProgram';
import { inferBusinessModel } from '@/lib/business/playbook';

/**
 * The Executive Overview.
 *
 * Assembled from whatever each granted capability chose to contribute, so a
 * company that later switches Legal off simply stops seeing Legal here — no
 * conditional in this file, no dead panel.
 */
export default async function CompanyOverviewPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { company, data, sharedMemory, basePath } = await loadCompanySpace(companyId);
  const capabilities = capabilitiesFor('company', company.disabledCapabilityIds);

  // Each contributed panel keeps its own capability, or Marketing's tile would
  // silently render whichever capability happened to own this page.
  const overviewSpecs = capabilities.flatMap((capability) =>
    (capability.overviewPanels ?? []).map((spec) => ownedBy(spec, capability.id)),
  );

  const openTasks = data.tasks.filter((t) => t.status !== 'done').length;
  const blocked = data.tasks.filter((t) => t.status === 'blocked').length;
  const armed = data.automations.filter((a) => a.status === 'armed');
  const savedMinutes = armed.reduce((s, a) => s + a.minutesSavedPerRun * a.runsThisMonth, 0);
  // The founder's own words about the business model decide which programme is
  // offered first. It is a suggestion on a radio group, never a lock-in.
  const suggestedModel = inferBusinessModel(company.dna.businessModel, company.industry);

  const actuals = data.finance.filter((e) => e.confidence !== 'forecast');
  const revenue = actuals.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount.amount, 0);
  const costs = actuals.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount.amount, 0);

  return (
    <>
      <PageHead
        eyebrow={`${company.industry} · ${company.stage}`}
        title={company.name}
        lede={company.description}
        actions={
          <>
            {company.generated ? <Badge tone="outline">Sample workspace</Badge> : null}
            <Link className="btn btn--secondary" href={`${basePath}/room`}>
              Team Room
            </Link>
            <Link className="btn btn--secondary" href={`${basePath}/dna`}>
              Company DNA
            </Link>
          </>
        }
      />

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <div className="exec-row">
            <ExecStat label="Net position" value={formatMinorAmount(revenue - costs, company.baseCurrency, { compact: true })} />
            <ExecStat label="Revenue booked" value={formatMinorAmount(revenue, company.baseCurrency, { compact: true })} />
            <ExecStat label="Open work" value={pluralise(openTasks, 'item')} />
            <ExecStat label="Blocked" value={String(blocked)} tone={blocked > 0 ? 'warn' : undefined} />
            <ExecStat label="Automated this month" value={formatDurationMinutes(savedMinutes)} />
            <ExecStat label="Capabilities" value={String(capabilities.length)} />
          </div>
        </div>
      </section>

      <CapabilityPanels
        specs={overviewSpecs}
        ctx={{
          spaceKind: 'company',
          capabilityId: 'executive',
          data,
          company,
          sharedMemory,
          basePath,
        }}
      />

      <SectionHead title="Recommendations" />
      <CapabilityPanels
        specs={[panel('suggestions', 'What I would do next', 12, { capabilityFilter: 'all' })]}
        ctx={{
          spaceKind: 'company',
          capabilityId: 'executive',
          data,
          company,
          sharedMemory,
          basePath,
        }}
      />

      <SectionHead title="Launch programme" />
      <div className="grid">
        <Panel
          span={12}
          title={`Take ${company.name} from nothing to something a stranger can buy from`}
          subtitle="The strategy, the numbers, the roadmap and the risks are written here and now. Everything that reaches the outside world is prepared and queued for you."
          footer="Running this twice produces the same plan, not a reshuffle — and the records it writes are ordinary records you can edit or delete."
        >
          <LaunchProgram
            companyId={company.id}
            suggestedModel={suggestedModel}
            currency={company.baseCurrency}
          />
        </Panel>
      </div>

      <SectionHead title="Capabilities" />
      <div className="capability-grid">
        {capabilities.map((capability) => (
          <Link key={capability.id} className="panel card-link" href={`${basePath}/${capability.id}`}>
            <div className="panel-body stack" style={{ gap: 'var(--s-2)' }}>
              <span className="eyebrow">{capability.group}</span>
              <span className="panel-title">{capabilityLabel(capability, 'company')}</span>
              <span className="hint">{capability.tagline}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function ExecStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className="stack" style={{ gap: 'var(--s-1)' }}>
      <span className="metric-label">{label}</span>
      <span className={tone ? 'metric-value delta--bad' : 'metric-value'}>{value}</span>
    </div>
  );
}
