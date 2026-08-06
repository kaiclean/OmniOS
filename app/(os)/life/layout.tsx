import type { Metadata } from 'next';

import { capabilitiesFor, capabilityLabel } from '@/lib/capabilities/registry';
import { loadPersonalSpace } from '@/lib/data/space';
import { SpaceTabs, type SpaceTab } from '@/components/company/SpaceTabs';

export const metadata: Metadata = { title: 'Life' };

export default async function LifeLayout({ children }: { children: React.ReactNode }) {
  const { personal } = await loadPersonalSpace();

  const tabs: SpaceTab[] = [
    { href: '/life', label: 'Overview', exact: true },
    { href: '/life/dna', label: 'Personal DNA' },
    ...capabilitiesFor('personal', personal.disabledCapabilityIds).map((capability) => ({
      href: `/life/${capability.id}`,
      label: capabilityLabel(capability, 'personal'),
    })),
  ];

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <SpaceTabs tabs={tabs} />
      {children}
    </div>
  );
}
