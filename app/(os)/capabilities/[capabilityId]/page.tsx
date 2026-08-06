import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { capabilityLabel, getCapability } from '@/lib/capabilities/registry';
import { loadSpaces } from '@/lib/data/aggregate';
import { readScope } from '@/lib/data/store';
import { sharedScope } from '@/lib/domain';
import { specialistsForCapability } from '@/lib/ai/specialists';
import { pluralise } from '@/lib/format';
import { Badge, Empty, ListRow, PageHead, Panel, SectionHead } from '@/components/ui/primitives';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ capabilityId: string }>;
}): Promise<Metadata> {
  const { capabilityId } = await params;
  const capability = getCapability(capabilityId);
  return capability ? { title: capability.name } : {};
}

/**
 * A capability at OS level.
 *
 * This is the capability-first thesis made visible: one platform, rendered once
 * per space it has been granted to, plus the shared knowledge it has accumulated
 * that no single space owns. Each space's section reads only that space's records
 * — the aggregation happens in the page, never inside a scope.
 */
export default async function OsCapabilityPage({
  params,
}: {
  params: Promise<{ capabilityId: string }>;
}) {
  const { capabilityId } = await params;
  const capability = getCapability(capabilityId);
  if (!capability) notFound();

  const spaces = await loadSpaces();
  const applicable = spaces.filter((space) => capability.appliesTo.includes(space.kind));
  const shared = await readScope(sharedScope(capability.id));
  const specialists = specialistsForCapability(capability.id);

  return (
    <>
      <PageHead
        eyebrow={`${capability.group} capability`}
        title={capability.name}
        lede={capability.description}
        actions={<Badge tone="outline">{pluralise(applicable.length, 'space')}</Badge>}
      />

      <div className="grid">
        <Panel title="Shared knowledge" subtitle="Generalised lessons no single space owns" span={8} flush>
          {shared.memory.length === 0 ? (
            <Empty title="Nothing promoted yet">
              A lesson only reaches this layer once it has been stripped of anything identifying —
              see the Brain for the gate that enforces it.
            </Empty>
          ) : (
            <div className="list">
              {shared.memory.map((record) => (
                <ListRow
                  key={record.id}
                  primary={record.text}
                  secondary={record.kind}
                  trailing={<Badge tone="info">shared</Badge>}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Specialists" subtitle="Consulted automatically, never chosen by you" span={4} flush>
          <div className="list">
            {specialists.map((specialist) => (
              <ListRow key={specialist.id} primary={specialist.name} secondary={specialist.role} />
            ))}
          </div>
        </Panel>
      </div>

      {applicable.map((space) => (
        <section key={space.scopeKey}>
          <SectionHead
            title={space.label}
            action={
              <Link className="btn btn--ghost btn--sm" href={`${space.href}/${capability.id}`}>
                Open in {space.kind === 'personal' ? 'Life' : 'company'}
              </Link>
            }
          />
          <CapabilityPanels
            specs={capability.overviewPanels ?? capability.panels.slice(0, 2)}
            ctx={{
              spaceKind: space.kind,
              capabilityId: capability.id,
              data: space.data,
              sharedMemory: shared.memory,
              basePath: space.href,
            }}
          />
        </section>
      ))}

      {applicable.length === 0 ? (
        <Panel span={12}>
          <Empty title={`${capabilityLabel(capability, 'company')} has no spaces yet`}>
            Create a company and it receives this capability automatically.
          </Empty>
        </Panel>
      ) : null}
    </>
  );
}
