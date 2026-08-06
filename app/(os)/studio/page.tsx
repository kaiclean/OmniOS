import type { Metadata } from 'next';
import Link from 'next/link';

import { panel } from '@/lib/capabilities/panels';
import { acrossSpaces, loadSpaces } from '@/lib/data/aggregate';
import { getWorkspace } from '@/lib/data/store';
import { specialistName } from '@/lib/ai/specialists';
import { EMPTY, formatDate, pluralise } from '@/lib/format';
import {
  Badge,
  Chips,
  DefinitionList,
  Empty,
  Metric,
  MetricGrid,
  PageHead,
  Panel,
  SectionHead,
  SimulatedMark,
  Stat,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { CapabilityPanels } from '@/components/panels/CapabilityPanels';
import { AssetPreview } from '@/components/creative/AssetPreview';
import { GenerateAssetsButton } from '@/components/creative/GenerateAssetsButton';
import { NewBriefForm } from '@/components/creative/NewBriefForm';

export const metadata: Metadata = { title: 'Creative Studio' };

const kindLabel = (kind: string): string => kind.replace(/-/g, ' ');

/**
 * The Creative Studio.
 *
 * One studio, every space. The selector is the only control that matters: it
 * changes which Brand DNA is in force, and everything below — briefs, prompts,
 * assets — is bound to that one scope. There is deliberately no "all spaces"
 * mode for output, because an asset produced against two brands is off-brand for
 * both.
 *
 * Nothing here renders pixels. That boundary is stated in the interface rather
 * than hidden behind a placeholder image, and the panel below names the exact
 * file a renderer would attach to.
 */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string }>;
}) {
  const { space } = await searchParams;
  const [spaces, workspace] = await Promise.all([loadSpaces(), getWorkspace()]);
  const selected = spaces.find((candidate) => candidate.scopeKey === space) ?? spaces[0];

  if (!selected) {
    return (
      <>
        <PageHead eyebrow="Every space" title="Creative Studio" />
        <Panel title="Nowhere to work">
          <Empty title="No spaces yet">
            The Studio produces work for a space, bound to that space’s Brand DNA. Create a company
            first.
          </Empty>
        </Panel>
      </>
    );
  }

  const company =
    selected.kind === 'company'
      ? workspace.companies.find((candidate) => candidate.id === selected.id)
      : undefined;
  const personal = selected.kind === 'personal' ? workspace.personal : undefined;
  const brand = company?.brand ?? personal?.personalBrand;

  const allBriefs = acrossSpaces(spaces, 'briefs');
  const allAssets = acrossSpaces(spaces, 'assets');
  const awaitingRender = allAssets.filter(({ item }) => item.status === 'brief').length;

  const byNewest = <T extends { createdAt: string }>(list: readonly T[]): T[] =>
    [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const briefs = byNewest(selected.data.briefs);
  const assets = byNewest(selected.data.assets);
  const assetsPerBrief = new Map<string, number>();
  for (const asset of assets) {
    if (asset.briefId) assetsPerBrief.set(asset.briefId, (assetsPerBrief.get(asset.briefId) ?? 0) + 1);
  }

  return (
    <>
      <PageHead
        eyebrow="Every space"
        title="Creative Studio"
        lede="Briefs in, assets out — every one of them held to the Brand DNA of the space you are working in. The pipeline is real; the render is the one step still waiting for a provider."
        actions={<SimulatedMark label="Placeholder renders" />}
      />

      <nav className="tab-row" aria-label="Spaces">
        {spaces.map((candidate) => (
          <Link
            key={candidate.scopeKey}
            className="tab"
            href={`/studio?space=${encodeURIComponent(candidate.scopeKey)}`}
            aria-current={candidate.scopeKey === selected.scopeKey ? 'page' : undefined}
          >
            {candidate.label}
          </Link>
        ))}
      </nav>

      <div className="grid" style={{ marginTop: 'var(--s-5)' }}>
        <Panel
          title="Across every space"
          span={12}
          subtitle={`${pluralise(spaces.length, 'space')} · counted from records, not estimated`}
        >
          <MetricGrid>
            <Metric label="Briefs" value={String(allBriefs.length)} hint="All spaces" />
            <Metric label="Assets" value={String(allAssets.length)} hint="All spaces" />
            <Metric
              label="Awaiting a renderer"
              value={String(awaitingRender)}
              hint="Status: brief · prompt already composed"
            />
            <Metric
              label="In this space"
              value={String(selected.data.assets.length)}
              hint={selected.label}
            />
          </MetricGrid>
        </Panel>

        <Panel
          title="No image model runs here"
          span={12}
          action={<Badge tone="outline">provider not set</Badge>}
        >
          <DefinitionList
            items={[
              {
                term: 'What happens when you generate',
                detail:
                  'One CreativeAsset record is written per format the brief names, with the full prompt composed from the brief and this space’s Brand DNA, a deterministic preview seed, and status “brief”. The record is real and stored in this space.',
              },
              {
                term: 'What does not happen',
                detail:
                  'Nothing leaves your machine. No pixels are produced, no provider key is read, and no external service is contacted. The tiles below are drawn from the asset id, not rendered from the prompt.',
              },
              {
                term: 'Where a renderer would attach',
                detail: (
                  <>
                    In <span className="mono">lib/actions/creative.ts</span>, immediately after the
                    asset records are written: an image provider registered beside{' '}
                    <span className="mono">lib/ai/providers.ts</span> consumes{' '}
                    <span className="mono">asset.prompt</span> and{' '}
                    <span className="mono">asset.aspect</span>, stores the result, and moves the
                    record from <span className="mono">brief</span> to{' '}
                    <span className="mono">draft</span>. Nothing else in the Studio changes.
                  </>
                ),
              },
              {
                term: 'Why it is built in this order',
                detail:
                  'The hard part of creative automation is not the render — it is holding output to a brand, keeping the brief reusable across formats, and being able to say later where an asset came from. That part exists. The step that costs money is the one left unplugged.',
              },
            ]}
          />
        </Panel>
      </div>

      <SectionHead title={`The constraint in force · ${selected.label}`} />
      {brand ? (
        <CapabilityPanels
          specs={[panel('brand-dna', 'Brand DNA', 12)]}
          ctx={{
            spaceKind: selected.kind,
            capabilityId: 'creative',
            data: selected.data,
            company,
            personal,
            basePath: selected.href,
          }}
        />
      ) : (
        <Panel title="Brand DNA">
          <Empty title="This space has no Brand DNA">
            Without one there is nothing to hold output to, and the Studio would be producing
            generic work with your name on it.
          </Empty>
        </Panel>
      )}

      <SectionHead title="Briefs" />
      <div className="grid">
        <Panel
          title={`In ${selected.label}`}
          span={8}
          subtitle={`${pluralise(briefs.length, 'brief')} · a brief is the reusable unit`}
          flush
        >
          {briefs.length === 0 ? (
            <Empty title="No briefs here yet">
              One brief can feed a post, an ad and a deck. Write the intent once.
            </Empty>
          ) : (
            <div className="list">
              {briefs.map((brief) => {
                const generated = assetsPerBrief.get(brief.id) ?? 0;
                return (
                  <div key={brief.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div className="grow stack" style={{ gap: 'var(--s-3)' }}>
                      <span className="spread">
                        <span className="list-primary">{brief.title}</span>
                        <span className="list-meta">{formatDate(brief.createdAt)}</span>
                      </span>
                      <p className="prose">{brief.objective}</p>
                      <div className="two-up">
                        <Stat label="Audience" value={brief.audience} />
                        <Stat label="Channel" value={brief.channel ?? EMPTY} />
                      </div>
                      {brief.keyMessage ? (
                        <Stat label="Key message" value={brief.keyMessage} />
                      ) : null}
                      <div className="stack" style={{ gap: 'var(--s-2)' }}>
                        <span className="eyebrow">Formats</span>
                        <Chips items={brief.formats.map(kindLabel)} />
                      </div>
                      {brief.mustInclude.length > 0 ? (
                        <div className="stack" style={{ gap: 'var(--s-2)' }}>
                          <span className="eyebrow">Must include</span>
                          <Chips items={brief.mustInclude} />
                        </div>
                      ) : null}
                      {brief.mustAvoid.length > 0 ? (
                        <div className="stack" style={{ gap: 'var(--s-2)' }}>
                          <span className="eyebrow">Never</span>
                          <Chips items={brief.mustAvoid} tone="warn" />
                        </div>
                      ) : null}
                      <div className="spread">
                        <span className="list-secondary">
                          {generated === 0
                            ? 'No assets generated from this brief yet'
                            : `${pluralise(generated, 'asset')} generated`}
                        </span>
                      </div>
                      <GenerateAssetsButton
                        scopeKey={selected.scopeKey}
                        briefId={brief.id}
                        formatCount={brief.formats.length}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="New brief" span={4} subtitle={`Written into ${selected.label}`}>
          <NewBriefForm scopeKey={selected.scopeKey} spaceLabel={selected.label} />
        </Panel>
      </div>

      <SectionHead title="Asset library" action={<SimulatedMark label="No model has run" />} />
      <div className="grid">
        <Panel
          title={`${selected.label} · ${pluralise(assets.length, 'asset')}`}
          span={12}
          subtitle="Open an asset to read the exact prompt a renderer would receive."
        >
          {assets.length === 0 ? (
            <Empty title="Nothing produced yet">
              Generate from a brief above and the records appear here immediately.
            </Empty>
          ) : (
            <div className="asset-grid">
              {assets.map((asset) => (
                <article key={asset.id} className="asset">
                  <AssetPreview seed={asset.previewSeed} aspect={asset.aspect} />
                  <div className="stack" style={{ gap: 'var(--s-2)' }}>
                    <span className="list-primary truncate">{asset.title}</span>
                    <span className="spread list-secondary">
                      <span>{kindLabel(asset.kind)}</span>
                      <Badge tone={asset.status === 'brief' ? 'outline' : 'accent'}>
                        {asset.status}
                      </Badge>
                    </span>
                    <span className="list-secondary">
                      {specialistName(asset.generatedBy)} · {asset.aspect}
                    </span>
                    <details className="plan">
                      <summary>
                        <Icon name="chevron-right" size={12} />
                        Prompt a renderer would receive
                      </summary>
                      <div className="plan-body">
                        <div className="plan-step">{asset.prompt}</div>
                        {asset.notes ? <div className="plan-step">{asset.notes}</div> : null}
                      </div>
                    </details>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
