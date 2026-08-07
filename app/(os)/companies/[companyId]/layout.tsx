import type { Metadata } from 'next';

import { capabilitiesFor, capabilityLabel } from '@/lib/capabilities/registry';
import { loadCompanySpace } from '@/lib/data/space';
import { SpaceTabs, type SpaceTab } from '@/components/company/SpaceTabs';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ companyId: string }>;
}): Promise<Metadata> {
  const { companyId } = await params;
  const { company } = await loadCompanySpace(companyId);
  return { title: company.name };
}

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { company } = await loadCompanySpace(companyId);
  const base = `/companies/${company.id}`;

  const tabs: SpaceTab[] = [
    { href: base, label: 'Executive', exact: true },
    { href: `${base}/dna`, label: 'DNA' },
    ...capabilitiesFor('company', company.disabledCapabilityIds).map((capability) => ({
      href: `${base}/${capability.id}`,
      label: capabilityLabel(capability, 'company'),
    })),
  ];

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <SpaceTabs tabs={tabs} />
      {children}
    </div>
  );
}
