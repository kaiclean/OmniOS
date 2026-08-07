import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { capabilitiesFor, capabilityLabel, getCapability } from '@/lib/capabilities/registry';
import { loadPersonalSpace } from '@/lib/data/space';
import { PageHead } from '@/components/ui/primitives';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ capabilityId: string }>;
}): Promise<Metadata> {
  const { capabilityId } = await params;
  const capability = getCapability(capabilityId);
  return capability ? { title: capabilityLabel(capability, 'personal') } : {};
}

/**
 * A capability inside personal life.
 *
 * Structurally identical to the company version — same registry, same renderer,
 * same panels. The only differences are the scope it loads and the label the
 * capability chose for a life rather than a business.
 */
export default async function LifeCapabilityPage({
  params,
}: {
  params: Promise<{ capabilityId: string }>;
}) {
  const { capabilityId } = await params;
  const capability = getCapability(capabilityId);
  if (!capability || !capability.appliesTo.includes('personal')) notFound();

  const { personal, data, sharedMemory, basePath } = await loadPersonalSpace();
  if (personal.disabledCapabilityIds.includes(capability.id)) notFound();

  const available = capabilitiesFor('personal', personal.disabledCapabilityIds);
  const position = available.findIndex((c) => c.id === capability.id) + 1;

  return (
    <>
      <PageHead
        eyebrow={`Life · capability ${position} of ${available.length}`}
        title={capabilityLabel(capability, 'personal')}
        lede={capability.description}
      />
      <CapabilityPanels
        specs={capability.panels}
        ctx={{
          spaceKind: 'personal',
          capabilityId: capability.id,
          data,
          personal,
          sharedMemory,
          basePath,
        }}
      />
    </>
  );
}
