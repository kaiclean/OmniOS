import type { Metadata } from 'next';

import { SPECIALIST_DOMAINS, personalScope } from '@/lib/domain';
import { capabilitiesFor } from '@/lib/capabilities/registry';
import { loadPersonalSpace } from '@/lib/data/space';
import { teamViewFor } from '@/lib/ai/team-view';
import { pluralise } from '@/lib/format';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';
import { TeamRoster } from '@/components/agents/TeamRoster';

export const metadata: Metadata = { title: 'Team' };

/** The personal roster: the voices life can call on, private to this space. */
export default async function LifeTeamPage() {
  const { personal } = await loadPersonalSpace();
  const { rows, presets } = await teamViewFor(personalScope());
  const active = rows.filter((row) => row.enabled).length;

  return (
    <>
      <PageHead
        eyebrow={personal.displayName}
        title="Team"
        lede="The specialists your life can call on — coaches and planners hired here stay here, invisible to every company. An agent only ever routes, speaks and proposes; anything that would act still stops for you."
        actions={<Badge tone="outline">{pluralise(active, 'active agent')}</Badge>}
      />
      <div className="grid">
        <Panel span={12}>
          <TeamRoster
            scopeKey="personal"
            basePath="/life/team"
            roster={rows}
            presets={presets}
            capabilityOptions={capabilitiesFor('personal').map((capability) => ({
              id: capability.id,
              name: capability.namePersonal ?? capability.name,
            }))}
            domainOptions={SPECIALIST_DOMAINS}
          />
        </Panel>
      </div>
    </>
  );
}
