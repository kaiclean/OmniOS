/**
 * Panels for suggestions, creative output, the AI team, and the DNA views
 * (company, brand, expansion, personal).
 *
 * Server Components. Anything generated rather than observed keeps its
 * `SimulatedMark`.
 */

import { EMPTY, formatPercent } from '@/lib/format';
import { specialistName, specialistsForCapability } from '@/lib/ai/specialists';
import { getCapability } from '@/lib/capabilities/registry';
import { Icon } from '@/components/ui/Icon';
import { AssetPreview } from '@/components/creative/AssetPreview';
import {
  Badge,
  Chips,
  DefinitionList,
  Empty,
  ListRow,
  Panel,
  SimulatedMark,
} from '@/components/ui/primitives';
import { scoped, type PanelProps, type SimplePanelProps } from './shared';

/* ----------------------------------------------------------- suggestions -- */

export function SuggestionsPanel({ title, span, spec, ctx }: PanelProps) {
  const suggestions = scoped(ctx.data.suggestions, spec, ctx).filter((s) => s.status === 'open');
  return (
    <Panel
      title={title}
      span={span}
      action={<SimulatedMark label="From your records" />}
      flush
    >
      {suggestions.length === 0 ? (
        <Empty title="Nothing to recommend right now" />
      ) : (
        <div className="list">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                <span className="spread">
                  <span className="list-primary">{suggestion.title}</span>
                  <span className="row" style={{ gap: 'var(--s-2)' }}>
                    <Badge tone={suggestion.impact === 'high' ? 'accent' : 'outline'}>
                      {suggestion.impact} impact
                    </Badge>
                    <Badge tone="outline">{suggestion.effort} effort</Badge>
                  </span>
                </span>
                <p className="prose">{suggestion.rationale}</p>
                <div className="spread list-secondary">
                  <span>
                    {specialistName(suggestion.specialistId)} · confidence{' '}
                    {formatPercent(suggestion.confidence * 100)}
                  </span>
                </div>
                {suggestion.evidence.length > 0 ? (
                  <details className="plan">
                    <summary>
                      <Icon name="chevron-right" size={12} />
                      Evidence
                    </summary>
                    <div className="plan-body">
                      {suggestion.evidence.map((line) => (
                        <div key={line} className="plan-step">
                          {line}
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- creative -- */

export function AssetsPanel({ title, span, spec, ctx }: PanelProps) {
  const assets = scoped(
    ctx.data.assets.map((a) => ({ ...a, capabilityId: 'creative' })),
    spec,
    ctx,
  );
  return (
    <Panel title={title} span={span} action={<SimulatedMark label="Placeholder renders" />}>
      {assets.length === 0 ? (
        <Empty title="No assets yet" />
      ) : (
        <div className="asset-grid">
          {assets.map((asset) => (
            <article key={asset.id} className="asset">
              <AssetPreview seed={asset.previewSeed} aspect={asset.aspect} />
              <div className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="list-primary truncate">{asset.title}</span>
                <span className="spread list-secondary">
                  <span>{asset.kind.replace('-', ' ')}</span>
                  <Badge tone="outline">{asset.status}</Badge>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function BriefsPanel({ title, span, spec, ctx }: PanelProps) {
  const briefs = scoped(
    ctx.data.briefs.map((b) => ({ ...b, capabilityId: 'creative' })),
    spec,
    ctx,
  );
  return (
    <Panel title={title} span={span} flush>
      {briefs.length === 0 ? (
        <Empty title="No briefs">A brief is the reusable unit — one brief can feed a post, an ad and a deck.</Empty>
      ) : (
        <div className="list">
          {briefs.map((brief) => (
            <div key={brief.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="list-primary">{brief.title}</span>
                <p className="prose">{brief.objective}</p>
                <span className="list-secondary">
                  {brief.audience} · {brief.formats.join(', ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function ProductsPanel({ title, span, ctx }: SimplePanelProps) {
  const products = ctx.data.products;
  return (
    <Panel title={title} span={span} flush>
      {products.length === 0 ? (
        <Empty title="No products specified yet">
          Describe an idea in the Product Factory and a full plan appears here.
        </Empty>
      ) : (
        <div className="list">
          {products.map((product) => (
            <ListRow
              key={product.id}
              primary={product.name}
              secondary={product.problem}
              meta={`${product.blocks.length} sections`}
              trailing={<Badge tone="outline">{product.status}</Badge>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- ai team -- */

export function AiTeamPanel({ title, span, ctx }: SimplePanelProps) {
  const capability = getCapability(ctx.capabilityId);
  const ids = capability?.specialistIds ?? [];
  const specialists = ids.length
    ? ids.map((id) => specialistsForCapability(ctx.capabilityId).find((s) => s.id === id)).filter(Boolean)
    : specialistsForCapability(ctx.capabilityId);

  return (
    <Panel
      title={title}
      span={span}
      subtitle="You never choose one of these — the assistant does."
      flush
    >
      <div className="list">
        {specialists.map((specialist) =>
          specialist ? (
            <div key={specialist.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="spread">
                  <span className="list-primary">{specialist.name}</span>
                  <Badge tone="outline">{specialist.domain}</Badge>
                </span>
                <p className="prose">{specialist.charter}</p>
                <ul className="list-secondary">
                  {specialist.wouldDo.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null,
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------- dna -- */

export function CompanyDnaPanel({ title, span, ctx }: SimplePanelProps) {
  const dna = ctx.company?.dna;
  if (!dna) return null;
  return (
    <Panel title={title} span={span}>
      <DefinitionList
        items={[
          { term: 'Mission', detail: dna.mission },
          { term: 'Vision', detail: dna.vision },
          { term: 'Purpose', detail: dna.purpose },
          { term: 'Business model', detail: dna.businessModel },
          { term: 'Long-term strategy', detail: dna.longTermStrategy },
          { term: 'Values', detail: <Chips items={dna.values} /> },
          { term: 'Moat', detail: dna.moat ?? EMPTY },
        ]}
      />
    </Panel>
  );
}

export function BrandDnaPanel({ title, span, ctx }: SimplePanelProps) {
  const brand = ctx.company?.brand ?? ctx.personal?.personalBrand;
  if (!brand) return null;
  return (
    <Panel
      title={title}
      span={span}
      subtitle="Every asset the Creative Studio produces is held to this."
    >
      <div className="stack">
        <div className="row wrap">
          {brand.palette.map((colour) => (
            <span key={colour.name} className="swatch">
              <span className="swatch-chip" style={{ background: colour.value }} />
              <span className="stack" style={{ gap: 0 }}>
                <span>{colour.name}</span>
                <span className="mono list-secondary">{colour.value}</span>
              </span>
            </span>
          ))}
        </div>
        <DefinitionList
          items={[
            { term: 'Voice', detail: <Chips items={brand.voice} /> },
            { term: 'Tone', detail: brand.tone },
            { term: 'Typography', detail: brand.typography },
            { term: 'Imagery', detail: brand.imagery },
            { term: 'Never', detail: <Chips items={brand.doNot} /> },
            { term: 'Taglines', detail: brand.taglines.join(' · ') },
          ]}
        />
      </div>
    </Panel>
  );
}

export function ExpansionPanel({ title, span, ctx }: SimplePanelProps) {
  const plans = ctx.company?.expansion ?? [];
  return (
    <Panel title={title} span={span} flush>
      {plans.length === 0 ? (
        <Empty title="No expansion plans" />
      ) : (
        <div className="list">
          {plans.map((plan) => (
            <ListRow
              key={plan.id}
              primary={plan.market}
              secondary={plan.rationale}
              meta={plan.horizon}
              trailing={<Badge tone={plan.status === 'live' ? 'ok' : 'outline'}>{plan.status}</Badge>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function PersonalDnaPanel({ title, span, ctx }: SimplePanelProps) {
  const dna = ctx.personal?.dna;
  if (!dna) return null;
  return (
    <Panel title={title} span={span}>
      <DefinitionList
        items={[
          { term: 'Identity', detail: dna.identity },
          { term: 'Long-term vision', detail: dna.longTermVision },
          { term: 'Health philosophy', detail: dna.healthPhilosophy },
          { term: 'Values', detail: <Chips items={dna.values} /> },
          { term: 'Life goals', detail: <Chips items={dna.lifeGoals} /> },
          { term: 'Financial goals', detail: <Chips items={dna.financialGoals} /> },
          { term: 'Non-negotiables', detail: <Chips items={dna.nonNegotiables} tone="warn" /> },
        ]}
      />
    </Panel>
  );
}
