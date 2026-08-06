import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { capabilitiesFor, capabilityLabel, getCapability } from '@/lib/capabilities/registry';
import { loadCompanySpace } from '@/lib/data/space';
import { PageHead } from '@/components/ui/primitives';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ companyId: string; capabilityId: string }>;
}): Promise<Metadata> {
  const { companyId, capabilityId } = await params;
  const capability = getCapability(capabilityId);
  if (!capability) return {};
  const { company } = await loadCompanySpace(companyId);
  return { title: `${capabilityLabel(capability, 'company')} · ${company.name}` };
}

/**
 * A capability inside a company.
 *
 * There is exactly one of these files for every capability a company has. The
 * page does not know what "Marketing" is — it looks the capability up in the
 * registry and renders whatever panels it declares against this company's scope.
 */
export default async function CompanyCapabilityPage({
  params,
}: {
  params: Promise<{ companyId: string; capabilityId: string }>;
}) {
  const { companyId, capabilityId } = await params;
  const capability = getCapability(capabilityId);
  if (!capability || !capability.appliesTo.includes('company')) notFound();

  const { company, data, sharedMemory, basePath } = await loadCompanySpace(companyId);
  if (company.disabledCapabilityIds.includes(capability.id)) notFound();

  const available = capabilitiesFor('company', company.disabledCapabilityIds);
  const position = available.findIndex((c) => c.id === capability.id) + 1;

  return (
    <>
      <PageHead
        eyebrow={`${company.name} · capability ${position} of ${available.length}`}
        title={capabilityLabel(capability, 'company')}
        lede={capability.description}
      />
      <CapabilityPanels
        specs={capability.panels}
        ctx={{
          spaceKind: 'company',
          capabilityId: capability.id,
          data,
          company,
          sharedMemory,
          basePath,
        }}
      />
    </>
  );
}
