import type { Metadata } from 'next';

import { SPECIALIST_DOMAINS } from '@/lib/domain';
import { capabilitiesFor } from '@/lib/capabilities/registry';
import { loadCompanySpace } from '@/lib/data/space';
import { teamViewFor } from '@/lib/ai/team-view';
import { pluralise } from '@/lib/format';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';
import { TeamRoster } from '@/components/agents/TeamRoster';

export const metadata: Metadata = { title: 'Team' };

/** The company's roster: who can be routed to, spoken with, and seated in the room. */
export default async function CompanyTeamPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { company, basePath } = await loadCompanySpace(companyId);
  const scope = { kind: 'company' as const, companyId: company.id };
  const { rows, presets } = await teamViewFor(scope);
  const active = rows.filter((row) => row.enabled).length;

  return (
    <>
      <PageHead
        eyebrow={company.name}
        title="Team"
        lede="Everyone this company can call on. Hire from a preset or invent a specialist; switch off the ones this business does not need. An agent only ever routes, speaks and proposes — power stays behind the approval gate."
        actions={<Badge tone="outline">{pluralise(active, 'active agent')}</Badge>}
      />
      <div className="grid">
        <Panel span={12}>
          <TeamRoster
            scopeKey={`company:${company.id}`}
            basePath={`${basePath}/team`}
            roster={rows}
            presets={presets}
            capabilityOptions={capabilitiesFor('company', company.disabledCapabilityIds).map(
              (capability) => ({ id: capability.id, name: capability.name }),
            )}
            domainOptions={SPECIALIST_DOMAINS}
          />
        </Panel>
      </div>
    </>
  );
}
