import Link from 'next/link';
import type { Metadata } from 'next';

import { capabilitiesFor } from '@/lib/capabilities/registry';
import { loadSpaces } from '@/lib/data/aggregate';
import { getWorkspace } from '@/lib/data/store';
import { formatMinorAmount, pluralise } from '@/lib/format';
import { hueForSpaceKey } from '@/lib/ui/space-tint';
import { Icon } from '@/components/ui/Icon';
import { Badge, Empty, PageHead, Panel } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Companies' };

export default async function CompaniesPage() {
  const [workspace, spaces] = await Promise.all([getWorkspace(), loadSpaces()]);
  const companySpaces = spaces.filter((s) => s.kind === 'company');
  const archived = workspace.companies.filter((c) => c.archivedAt);

  return (
    <>
      <PageHead
        eyebrow="Spaces"
        title="Companies"
        lede={`Every company receives all ${capabilitiesFor('company').length} capabilities the moment it exists. Nothing is configured per company, and nothing is rebuilt for the next one.`}
        actions={
          <Link className="btn btn--primary" href="/companies/new">
            <Icon name="plus" />
            New company
          </Link>
        }
      />

      {companySpaces.length === 0 ? (
        <Panel span={12}>
          <Empty title="No companies yet">
            Creating one takes a name. The headquarters is generated for you.
          </Empty>
        </Panel>
      ) : (
        <div className="capability-grid">
          {companySpaces.map((space) => {
            const company = workspace.companies.find((c) => c.id === space.id);
            if (!company) return null;
            const actuals = space.data.finance.filter((e) => e.confidence !== 'forecast');
            const net = actuals.reduce(
              (sum, e) => sum + (e.direction === 'in' ? e.amount.amount : -e.amount.amount),
              0,
            );
            const open = space.data.tasks.filter((t) => t.status !== 'done').length;

            return (
              <Link key={space.id} className="panel card-link" href={space.href}>
                <div className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
                  <div className="row">
                    <span
                      className="space-dot"
                      style={{
                        background: `oklch(0.76 0.118 ${hueForSpaceKey(space.scopeKey)})`,
                        color: `oklch(0.76 0.118 ${hueForSpaceKey(space.scopeKey)})`,
                      }}
                    />
                    <span className="panel-title grow truncate">{company.name}</span>
                    <Badge tone="outline">{company.stage}</Badge>
                  </div>
                  <p className="hint">{company.description}</p>
                  <div className="spread list-secondary">
                    <span>{company.industry}</span>
                    <span>
                      {formatMinorAmount(net, company.baseCurrency, { compact: true })} ·{' '}
                      {pluralise(open, 'open item')}
                    </span>
                  </div>
                  {company.generated ? (
                    <div className="chip-row">
                      <Badge tone="outline">Sample workspace</Badge>
                    </div>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {archived.length > 0 ? (
        <Panel title="Archived" span={12} flush>
          <div className="list">
            {archived.map((company) => (
              <div key={company.id} className="list-row">
                <span className="grow list-primary">{company.name}</span>
                <span className="list-meta">archived</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
