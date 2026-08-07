import type { Metadata } from 'next';

import { loadPersonalSpace } from '@/lib/data/space';
import { panel } from '@/lib/capabilities/panels';
import { PageHead } from '@/components/ui/primitives';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';

export const metadata: Metadata = { title: 'Personal DNA' };

export default async function PersonalDnaPage() {
  const { personal, data, sharedMemory, basePath } = await loadPersonalSpace();

  return (
    <>
      <PageHead
        eyebrow={personal.displayName}
        title="Personal DNA"
        lede="A company gets a mission statement; a life gets this. The assistant reads it before it suggests anything — which is how it knows that a commitment made at 23:00 is one you will regret."
      />
      <CapabilityPanels
        specs={[panel('personal-dna', 'Who you are', 8), panel('brand-dna', 'Personal brand', 4)]}
        ctx={{
          spaceKind: 'personal',
          capabilityId: 'life-ops',
          data,
          personal,
          sharedMemory,
          basePath,
        }}
      />
    </>
  );
}
