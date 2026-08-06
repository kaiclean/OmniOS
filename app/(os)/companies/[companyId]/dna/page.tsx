import type { Metadata } from 'next';

import { loadCompanySpace } from '@/lib/data/space';
import { panel } from '@/lib/capabilities/panels';
import { Badge, Empty, PageHead, Panel } from '@/components/ui/primitives';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';

export const metadata: Metadata = { title: 'DNA' };

export default async function CompanyDnaPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { company, data, sharedMemory, basePath } = await loadCompanySpace(companyId);
  const { dna } = company;

  return (
    <>
      <PageHead
        eyebrow={company.name}
        title="Company DNA"
        lede="The part a founder writes once and edits rarely. Every specialist reads this before it answers anything about this company."
      />

      <CapabilityPanels
        specs={[
          panel('company-dna', 'Identity', 8),
          panel('brand-dna', 'Brand', 4),
          panel('expansion', 'Markets', 12),
        ]}
        ctx={{ spaceKind: 'company', capabilityId: 'strategy', data, company, sharedMemory, basePath }}
      />

      <div className="grid" style={{ marginTop: 'var(--s-5)' }}>
        <Panel title="Who it is for" span={6} flush>
          {dna.targetAudience.length === 0 ? (
            <Empty title="No audience defined" />
          ) : (
            <div className="list">
              {dna.targetAudience.map((segment) => (
                <div key={segment.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                    <span className="list-primary">{segment.label}</span>
                    <p className="prose">{segment.description}</p>
                    <ul className="list-secondary">
                      {segment.pains.map((pain) => (
                        <li key={pain}>· {pain}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Who it is against" span={6} flush>
          {dna.competitors.length === 0 ? (
            <Empty title="No competitors named" />
          ) : (
            <div className="list">
              {dna.competitors.map((competitor) => (
                <div key={competitor.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                    <span className="spread">
                      <span className="list-primary">{competitor.name}</span>
                      <Badge
                        tone={
                          competitor.threat === 'high'
                            ? 'deny'
                            : competitor.threat === 'medium'
                              ? 'warn'
                              : 'outline'
                        }
                      >
                        {competitor.threat} threat
                      </Badge>
                    </span>
                    <p className="prose">{competitor.positioning}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
