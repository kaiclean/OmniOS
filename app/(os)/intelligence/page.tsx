import type { Metadata } from 'next';
import Link from 'next/link';

import { getWorkspace } from '@/lib/data/store';
import { DISCOVERY_KINDS } from '@/lib/domain';
import type { Discovery } from '@/lib/domain';
import { EMPTY, formatDate, formatNumber, formatRelative, pluralise, titleCase } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Chips,
  Empty,
  ListRow,
  Meter,
  Metric,
  MetricGrid,
  Note,
  Panel,
  PageHead,
  SectionHead,
  SimulatedMark,
  type Tone,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'AI Intelligence Center' };

/**
 * The bar an item has to clear to reach the feed.
 *
 * Kept identical to the threshold `generateLearningReport` uses for its "worth
 * your attention" section, so "cleared the bar" means the same number here and
 * in a report. If these two ever disagree the founder is being told two stories.
 */
const RELEVANCE_THRESHOLD = 70;

/**
 * The AI Intelligence Center.
 *
 * The score is the product, not the feed. Anyone can list what happened in AI
 * this week; the useful part is a number that says how much it matters to *this*
 * workspace and a sentence saying why it got that number. So every item shows
 * its reasons, and everything scored down is listed rather than hidden — a feed
 * that only surfaces exciting things is a hype feed with a search box.
 */
export default async function IntelligencePage() {
  const workspace = await getWorkspace();

  const ranked = [...workspace.discoveries].sort(
    (a, b) => b.relevance - a.relevance || (a.publishedAt < b.publishedAt ? 1 : -1),
  );
  const cleared = ranked.filter((item) => item.relevance >= RELEVANCE_THRESHOLD);
  const filtered = ranked.filter((item) => item.relevance < RELEVANCE_THRESHOLD);

  const newest = [...ranked].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))[0];
  const top = ranked[0];
  const awaiting = workspace.upgrades.filter((upgrade) => upgrade.stage === 'awaiting-approval').length;
  const promoted = ranked.filter((item) => item.status === 'promoted').length;

  const byKind = DISCOVERY_KINDS.map((kind) => ({
    kind,
    count: ranked.filter((item) => item.kind === kind).length,
  })).filter((entry) => entry.count > 0);

  const sources = [...new Set(ranked.map((item) => item.sourceLabel))].sort();
  const liveFeed = ranked.some((item) => !item.simulated);

  return (
    <>
      <PageHead
        eyebrow="Systems"
        title="AI Intelligence Center"
        lede="What moved in the AI ecosystem, scored against what this workspace actually runs. Most of it should score low — that is the feed working, not failing."
        actions={
          <>
            <Link className="btn btn--secondary" href="/intelligence/upgrades">
              Upgrade pipeline
              {awaiting > 0 ? <Badge tone="accent">{awaiting}</Badge> : null}
            </Link>
            <Link className="btn btn--secondary" href="/intelligence/reports">
              Learning reports
            </Link>
          </>
        }
      />

      <section className="panel span-12" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <MetricGrid>
            <Metric
              label="Items scanned"
              value={formatNumber(ranked.length)}
              hint={liveFeed ? 'Live source' : 'Bundled sample set'}
            />
            <Metric
              label="Cleared the bar"
              value={formatNumber(cleared.length)}
              hint={`Relevance ${RELEVANCE_THRESHOLD}+`}
            />
            <Metric
              label="Scored down"
              value={formatNumber(filtered.length)}
              hint="Listed below, not hidden"
            />
            <Metric
              label="Highest score"
              value={top ? formatNumber(top.relevance) : EMPTY}
              hint={top ? top.kind : undefined}
            />
            <Metric
              label="Promoted to pipeline"
              value={formatNumber(promoted)}
              hint={`${pluralise(awaiting, 'decision')} waiting`}
            />
            <Metric
              label="Most recent item"
              value={newest ? formatDate(newest.publishedAt) : EMPTY}
              hint={newest ? formatRelative(newest.publishedAt) : undefined}
            />
          </MetricGrid>
        </div>
      </section>

      <div className="grid">
        <Panel
          title="Cleared the relevance bar"
          subtitle={`Scored ${RELEVANCE_THRESHOLD} or above against what this workspace runs`}
          span={8}
          flush
          footer={`Sorted by relevance, not by date. ${pluralise(filtered.length, 'further item')} scored below the bar.`}
        >
          {cleared.length === 0 ? (
            <Empty title="Nothing cleared the bar">
              Every item in the feed scored below {RELEVANCE_THRESHOLD}. That is a normal week.
            </Empty>
          ) : (
            <div className="list">
              {cleared.map((item) => (
                <DiscoveryRow key={item.id} discovery={item} />
              ))}
            </div>
          )}
        </Panel>

        <div className="stack span-4" style={{ gap: 'var(--s-5)' }}>
          <Panel title="How an item gets its score">
            <div className="stack" style={{ gap: 'var(--s-3)' }}>
              <p className="prose">
                Relevance is scored against this workspace — the capabilities it runs, the
                dependencies it already carries and the problems it currently has. It is not a
                judgement about the item, and it is not a popularity number.
              </p>
              <p className="prose">
                A model release that nothing here would use scores low even if it is genuinely
                significant. A practice change that removes a dependency scores high even if nobody
                else noticed it.
              </p>
              <div className="row wrap">
                <Badge tone="accent">{RELEVANCE_THRESHOLD}+ reaches the feed</Badge>
                <Badge tone="outline">Below is kept, not deleted</Badge>
              </div>
            </div>
          </Panel>

          <Panel title="By kind" flush>
            {byKind.length === 0 ? (
              <Empty title="Nothing in the feed yet" />
            ) : (
              <div className="list">
                {byKind.map((entry) => (
                  <ListRow
                    key={entry.kind}
                    primary={humanise(entry.kind)}
                    meta={formatNumber(entry.count)}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Sources">
            <Chips items={sources} />
          </Panel>
        </div>
      </div>

      <SectionHead title="Scored below the bar" />
      <Note icon="telescope">
        These {pluralise(filtered.length, 'item')} were read and scored down. They stay visible
        because a feed that only shows what excites it cannot be checked — the reason an item was
        dismissed is as much a part of the record as the reason one was promoted.
      </Note>

      <div className="grid" style={{ marginTop: 'var(--s-5)' }}>
        <Panel span={12} flush>
          {filtered.length === 0 ? (
            <Empty title="Nothing was filtered out">
              Every item in the feed cleared the bar, which usually means the feed is too narrow.
            </Empty>
          ) : (
            <div className="list">
              {filtered.map((item) => (
                <ListRow
                  key={item.id}
                  primary={
                    <span className="row wrap">
                      <span>{item.title}</span>
                      <Badge tone="outline">{humanise(item.kind)}</Badge>
                    </span>
                  }
                  secondary={item.relevanceReasons[0] ?? item.summary}
                  meta={
                    <span className="row" style={{ gap: 'var(--s-3)' }}>
                      <span>{formatDate(item.publishedAt)}</span>
                      <span className="mono">{formatNumber(item.relevance)}</span>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ row --- */

function DiscoveryRow({ discovery }: { discovery: Discovery }) {
  return (
    <article className="list-row" style={{ alignItems: 'flex-start' }}>
      <div className="intel-score">
        <span className="intel-score-value">{formatNumber(discovery.relevance)}</span>
        <Meter
          value={discovery.relevance / 100}
          tone={discovery.relevance >= 80 ? 'ok' : 'warn'}
          label={`Relevance ${discovery.relevance} out of 100`}
        />
      </div>

      <div className="grow stack" style={{ gap: 'var(--s-3)' }}>
        <div className="row wrap">
          <span className="list-primary">{discovery.title}</span>
          <Badge tone="outline">{humanise(discovery.kind)}</Badge>
          <Badge tone={statusTone(discovery.status)}>{discovery.status}</Badge>
          {discovery.simulated ? <SimulatedMark label="Sample feed" /> : null}
        </div>

        <p className="prose">{discovery.summary}</p>

        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <span className="eyebrow">Why it scored {formatNumber(discovery.relevance)}</span>
          {discovery.relevanceReasons.length === 0 ? (
            <span className="hint">{EMPTY} no reasoning was recorded for this score</span>
          ) : (
            <ul className="stack" style={{ gap: 'var(--s-1)' }}>
              {discovery.relevanceReasons.map((reason) => (
                <li key={reason} className="hint">
                  · {reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        {discovery.affects.length > 0 ? (
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            <span className="eyebrow">Would touch</span>
            <Chips items={discovery.affects} />
          </div>
        ) : null}

        <div className="row wrap list-secondary">
          <span>{discovery.sourceLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDate(discovery.publishedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelative(discovery.publishedAt)}</span>
          {discovery.sourceUrl ? (
            <a
              className="btn btn--ghost btn--sm"
              href={discovery.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open source
              <Icon name="arrow-up-right" />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function statusTone(status: Discovery['status']): Tone {
  switch (status) {
    case 'promoted':
      return 'accent';
    case 'triaged':
      return 'info';
    case 'archived':
      return 'outline';
    default:
      return 'neutral';
  }
}

/** `reasoning-model` reads as a slug; the interface should not. */
function humanise(value: string): string {
  return titleCase(value.replace(/-/g, ' '));
}
