import type { Metadata } from 'next';

import { generationSummary } from '@/lib/generation/company-hq';
import { PageHead } from '@/components/ui/primitives';
import { CreateCompanyForm } from '@/components/company/CreateCompanyForm';

export const metadata: Metadata = { title: 'Create a company' };

export default function NewCompanyPage() {
  return (
    <>
      <PageHead
        eyebrow="New space"
        title="Create a company"
        lede="Describe it once. OmniOS generates the headquarters — every capability, already populated — and you walk into a company that is running rather than a blank page you have to furnish."
      />
      <CreateCompanyForm generates={generationSummary()} />
    </>
  );
}
