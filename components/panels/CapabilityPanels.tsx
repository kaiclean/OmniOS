/**
 * The panel renderer.
 *
 * This file is the mechanism behind the product's core claim. A Capability
 * declares a list of panel specs; this renders them against whatever space is
 * open. Nothing below knows whether it is drawing a company or a life — it
 * receives scoped records and draws them. That is why creating a company
 * produces a complete headquarters without a line of company-specific code, and
 * why adding a capability is a registry edit rather than a feature.
 */

import Link from 'next/link';

import type { PanelSpec } from '@/lib/capabilities/panels';
import { panelTitle } from '@/lib/capabilities/panels';
import type { ScopeData } from '@/lib/data/schema';
import type { Company, MemoryRecord, PersonalProfile } from '@/lib/domain';
import {
  EMPTY,
  daysBetween,
  formatDate,
  formatDurationMinutes,
  formatKpiValue,
  formatMinorAmount,
  formatNumber,
  formatPercent,
  pluralise,
  titleCase,
} from '@/lib/format';
import { deriveEnergy, energyLabel, energyOf } from '@/lib/personal/energy';
import { specialistName, specialistsForCapability } from '@/lib/ai/specialists';
import { getCapability } from '@/lib/capabilities/registry';
import { Icon } from '@/components/ui/Icon';
import { AssetPreview } from '@/components/creative/AssetPreview';
import {
  Badge,
  Chips,
  DefinitionList,
  Empty,
  KpiTile,
  ListRow,
  Meter,
  Metric,
  MetricGrid,
  Panel,
  SimulatedMark,
  Spark,
} from '@/components/ui/primitives';

export interface PanelContext {
  readonly spaceKind: 'company' | 'personal';
  readonly capabilityId: string;
  readonly data: ScopeData;
  readonly company?: Company;
  readonly personal?: PersonalProfile;
  readonly sharedMemory?: readonly MemoryRecord[];
  /** Base href of the space, for panel "see all" links. */
  readonly basePath: string;
}

export function CapabilityPanels({
  specs,
  ctx,
}: {
  specs: readonly PanelSpec[];
  ctx: PanelContext;
}) {
  return (
    <div className="grid">
      {specs.map((spec, index) => (
        <CapabilityPanel key={`${spec.kind}:${index}`} spec={spec} ctx={ctx} />
      ))}
    </div>
  );
}

/** Restrict a collection to the capability that owns the panel, when asked to. */
function scoped<T extends { capabilityId: string }>(
  items: readonly T[],
  spec: PanelSpec,
  ctx: PanelContext,
): T[] {
  const owner = spec.capabilityId ?? ctx.capabilityId;
  const list =
    spec.capabilityFilter === 'all' ? [...items] : items.filter((i) => i.capabilityId === owner);
  return spec.limit ? list.slice(0, spec.limit) : list;
}

function CapabilityPanel({ spec, ctx }: { spec: PanelSpec; ctx: PanelContext }) {
  const title = panelTitle(spec, ctx.spaceKind);
  const span = spec.span;

  switch (spec.kind) {
    case 'kpi-grid':
      return <KpiPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'goals':
      return <GoalsPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'tasks':
      return <TasksPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'roadmap':
      return <RoadmapPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'automations':
      return <AutomationsPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'knowledge':
      return <KnowledgePanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'crm':
      return <CrmPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'finance-summary':
      return <FinanceSummaryPanel title={title} span={span} ctx={ctx} />;
    case 'finance-ledger':
      return <FinanceLedgerPanel title={title} span={span} ctx={ctx} />;
    case 'risks':
      return <RisksPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'suggestions':
      return <SuggestionsPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'assets':
      return <AssetsPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'briefs':
      return <BriefsPanel title={title} span={span} spec={spec} ctx={ctx} />;
    case 'ai-team':
      return <AiTeamPanel title={title} span={span} ctx={ctx} />;
    case 'company-dna':
      return <CompanyDnaPanel title={title} span={span} ctx={ctx} />;
    case 'brand-dna':
      return <BrandDnaPanel title={title} span={span} ctx={ctx} />;
    case 'expansion':
      return <ExpansionPanel title={title} span={span} ctx={ctx} />;
    case 'personal-dna':
      return <PersonalDnaPanel title={title} span={span} ctx={ctx} />;
    case 'health':
      return <HealthPanel title={title} span={span} ctx={ctx} />;
    case 'habits':
      return <HabitsPanel title={title} span={span} ctx={ctx} />;
    case 'relationships':
      return <RelationshipsPanel title={title} span={span} ctx={ctx} />;
    case 'learning':
      return <LearningPanel title={title} span={span} ctx={ctx} />;
    case 'life-admin':
      return <LifeAdminPanel title={title} span={span} ctx={ctx} />;
    case 'calendar':
      return <CalendarPanel title={title} span={span} ctx={ctx} />;
    case 'products':
      return <ProductsPanel title={title} span={span} ctx={ctx} />;
    case 'memory':
      return <MemoryPanel title={title} span={span} spec={spec} ctx={ctx} />;
  }
}

type PanelProps = { title: string; span: PanelSpec['span']; spec: PanelSpec; ctx: PanelContext };
type SimplePanelProps = { title: string; span: PanelSpec['span']; ctx: PanelContext };

/* ------------------------------------------------------------------ kpis -- */

function KpiPanel({ title, span, spec, ctx }: PanelProps) {
  const kpis = scoped(ctx.data.kpis, spec, ctx);
  return (
    <Panel title={title} span={span}>
      {kpis.length === 0 ? (
        <Empty title="No metrics yet">Metrics appear as this capability accumulates records.</Empty>
      ) : (
        <MetricGrid>
          {kpis.map((kpi) => (
            <KpiTile key={kpi.id} kpi={kpi} />
          ))}
        </MetricGrid>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- goals -- */

const GOAL_TONE = {
  'on-track': 'ok',
  'at-risk': 'warn',
  'off-track': 'deny',
  achieved: 'accent',
  paused: 'neutral',
} as const;

function GoalsPanel({ title, span, spec, ctx }: PanelProps) {
  const goals = scoped(ctx.data.goals, spec, ctx);
  return (
    <Panel title={title} span={span} flush>
      {goals.length === 0 ? (
        <Empty title="No goals set">A space without goals cannot tell you what is off track.</Empty>
      ) : (
        <div className="list">
          {goals.map((goal) => (
            <div key={goal.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                <div className="spread">
                  <span className="list-primary">{goal.title}</span>
                  <Badge tone={GOAL_TONE[goal.status]}>{goal.status.replace('-', ' ')}</Badge>
                </div>
                <Meter
                  value={goal.progress}
                  label={goal.title}
                  tone={goal.status === 'on-track' ? 'ok' : goal.status === 'at-risk' ? 'warn' : undefined}
                />
                <div className="spread list-secondary">
                  <span>
                    {titleCase(goal.horizon.replace('-', ' '))}
                    {goal.targetDate ? ` · ${formatDate(goal.targetDate)}` : ''}
                  </span>
                  <span>{formatPercent(goal.progress * 100)}</span>
                </div>
                {goal.why ? <span className="list-secondary">{goal.why}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- tasks -- */

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;

function TasksPanel({ title, span, spec, ctx }: PanelProps) {
  const tasks = scoped(ctx.data.tasks, spec, ctx).sort(
    (a, b) =>
      Number(a.status === 'done') - Number(b.status === 'done') ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
  const open = tasks.filter((t) => t.status !== 'done').length;

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`${pluralise(open, 'open item')} · ${tasks.length - open} done`}
      flush
    >
      {tasks.length === 0 ? (
        <Empty title="Nothing here">Work added to this capability shows up here.</Empty>
      ) : (
        <div className="list">
          {tasks.slice(0, spec.limit ?? 12).map((task) => (
            <ListRow
              key={task.id}
              done={task.status === 'done'}
              primary={task.title}
              secondary={
                task.status === 'blocked' && task.blockedReason
                  ? `Blocked — ${task.blockedReason}`
                  : `${task.priority.toUpperCase()} · ${task.energy} · ${formatDurationMinutes(task.estimateMinutes)}`
              }
              meta={task.dueDate ? formatDate(task.dueDate) : EMPTY}
              trailing={
                task.status === 'blocked' ? (
                  <Badge tone="deny" dot>
                    blocked
                  </Badge>
                ) : task.status === 'active' ? (
                  <Badge tone="accent" dot>
                    active
                  </Badge>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- roadmap -- */

const STAGE_TONE = {
  idea: 'neutral',
  planned: 'info',
  building: 'accent',
  shipped: 'ok',
  parked: 'outline',
} as const;

function RoadmapPanel({ title, span, spec, ctx }: PanelProps) {
  const items = scoped(ctx.data.roadmap, spec, ctx);
  const stages = ['building', 'planned', 'idea', 'shipped', 'parked'] as const;

  return (
    <Panel title={title} span={span}>
      {items.length === 0 ? (
        <Empty title="Nothing on the roadmap" />
      ) : (
        <div className="roadmap">
          {stages.map((stage) => {
            const inStage = items.filter((i) => i.stage === stage);
            if (inStage.length === 0) return null;
            return (
              <div key={stage} className="roadmap-col">
                <div className="spread">
                  <span className="eyebrow">{stage}</span>
                  <span className="list-meta">{inStage.length}</span>
                </div>
                {inStage.map((item) => (
                  <div key={item.id} className="roadmap-card">
                    <span>{item.title}</span>
                    <div className="spread list-secondary">
                      <span>{item.horizon}</span>
                      <Badge tone={STAGE_TONE[item.stage]}>{formatPercent(item.confidence * 100)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- automations -- */

const AUTOMATION_TONE = { armed: 'ok', draft: 'neutral', paused: 'outline', failing: 'deny' } as const;

function AutomationsPanel({ title, span, spec, ctx }: PanelProps) {
  const automations = scoped(ctx.data.automations, spec, ctx);
  const saved = automations
    .filter((a) => a.status === 'armed')
    .reduce((sum, a) => sum + a.minutesSavedPerRun * a.runsThisMonth, 0);

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`${formatDurationMinutes(saved)} returned this month`}
      flush
      footer={
        <span className="row">
          <Icon name="shield" size={13} />
          Nothing reaches outside OmniOS without your approval.
        </span>
      }
    >
      {automations.length === 0 ? (
        <Empty title="No automations yet" />
      ) : (
        <div className="list">
          {automations.map((automation) => (
            <ListRow
              key={automation.id}
              primary={automation.name}
              secondary={`${automation.triggerDetail} · ${pluralise(automation.steps.length, 'step')}`}
              meta={
                automation.status === 'armed'
                  ? `${formatDurationMinutes(automation.minutesSavedPerRun)}/run`
                  : `${formatDurationMinutes(automation.minutesSavedPerRun)} potential`
              }
              trailing={
                <span className="row" style={{ gap: 'var(--s-2)' }}>
                  {automation.requiresApproval ? <Badge tone="warn">approval</Badge> : null}
                  <Badge tone={AUTOMATION_TONE[automation.status]} dot>
                    {automation.status}
                  </Badge>
                </span>
              }
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- knowledge -- */

function KnowledgePanel({ title, span, spec, ctx }: PanelProps) {
  const docs = scoped(ctx.data.docs, spec, ctx);
  return (
    <Panel title={title} span={span} flush>
      {docs.length === 0 ? (
        <Empty title="No documents">Decisions and processes recorded here become the AI&rsquo;s context.</Empty>
      ) : (
        <div className="list">
          {docs.map((doc) => (
            <div key={doc.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="spread">
                  <span className="list-primary">{doc.title}</span>
                  <Badge tone="outline">{doc.kind}</Badge>
                </span>
                <p className="prose">{doc.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------- crm -- */

const CRM_TONE = {
  lead: 'neutral',
  qualified: 'info',
  proposal: 'accent',
  won: 'ok',
  lost: 'deny',
  dormant: 'outline',
} as const;

function CrmPanel({ title, span, spec, ctx }: PanelProps) {
  const contacts = scoped(
    ctx.data.contacts.map((c) => ({ ...c, capabilityId: 'sales' })),
    spec,
    ctx,
  );
  const open = contacts.filter((c) => !['won', 'lost', 'dormant'].includes(c.stage));
  const value = open.reduce((sum, c) => sum + (c.value?.amount ?? 0), 0);
  const currency = open[0]?.value?.currency ?? 'CHF';

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`${pluralise(open.length, 'open conversation')} · ${formatMinorAmount(value, currency, { compact: true })}`}
      flush
    >
      {contacts.length === 0 ? (
        <Empty title="No contacts yet" />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Stage</th>
                <th className="num">Value</th>
                <th>Next touch</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const overdue =
                  contact.nextTouchAt !== undefined && daysBetween(contact.nextTouchAt) > 0;
                return (
                  <tr key={contact.id}>
                    <td>
                      <div className="list-primary">{contact.name}</div>
                      <div className="list-secondary">
                        {contact.organisation ?? EMPTY}
                        {contact.role ? ` · ${contact.role}` : ''}
                      </div>
                    </td>
                    <td>
                      <Badge tone={CRM_TONE[contact.stage]}>{contact.stage}</Badge>
                    </td>
                    <td className="num">{formatMinorAmount(contact.value?.amount, currency, { compact: true })}</td>
                    <td>
                      {contact.nextTouchAt ? (
                        <span className={overdue ? 'delta--bad' : undefined}>
                          {formatDate(contact.nextTouchAt)}
                          {overdue ? ' · overdue' : ''}
                        </span>
                      ) : (
                        EMPTY
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- finance -- */

function FinanceSummaryPanel({ title, span, ctx }: SimplePanelProps) {
  const entries = ctx.data.finance;
  const currency = entries[0]?.amount.currency ?? 'CHF';
  const actuals = entries.filter((e) => e.confidence !== 'forecast');
  const forecast = entries.filter((e) => e.confidence === 'forecast');

  const sum = (list: typeof entries, direction: 'in' | 'out') =>
    list.filter((e) => e.direction === direction).reduce((s, e) => s + e.amount.amount, 0);

  const revenue = sum(actuals, 'in');
  const costs = sum(actuals, 'out');
  const profit = revenue - costs;
  const months = new Set(actuals.map((e) => e.date.slice(0, 7))).size || 1;
  const burn = costs / months;
  const runway = burn > 0 ? profit / burn : null;

  const byMonth = new Map<string, number>();
  for (const entry of actuals) {
    const key = entry.date.slice(0, 7);
    const delta = entry.direction === 'in' ? entry.amount.amount : -entry.amount.amount;
    byMonth.set(key, (byMonth.get(key) ?? 0) + delta);
  }
  const trend = [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v / 100);

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`${months} months of actuals · ${forecast.length} forecast entries excluded`}
    >
      <MetricGrid>
        <Metric
          label="Revenue"
          value={formatMinorAmount(revenue, currency, { compact: true })}
          hint={`${months} months`}
        />
        <Metric label="Costs" value={formatMinorAmount(costs, currency, { compact: true })} hint={`${months} months`} />
        <Metric
          label="Net"
          value={formatMinorAmount(profit, currency, { compact: true })}
          delta={{ text: profit >= 0 ? 'positive' : 'negative', tone: profit >= 0 ? 'good' : 'bad' }}
          series={trend}
          hint="Monthly net"
        />
        <Metric
          label="Runway at this burn"
          value={runway === null ? EMPTY : `${formatNumber(runway, 1)} mo`}
          hint={`${formatMinorAmount(Math.round(burn), currency, { compact: true })}/mo`}
        />
      </MetricGrid>
    </Panel>
  );
}

function FinanceLedgerPanel({ title, span, ctx }: SimplePanelProps) {
  const entries = [...ctx.data.finance].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);
  return (
    <Panel title={title} span={span} flush>
      {entries.length === 0 ? (
        <Empty title="No entries" />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Label</th>
                <th>Category</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.date)}</td>
                  <td>
                    <span className="list-primary">{entry.label}</span>
                    {entry.confidence !== 'actual' ? (
                      <span className="list-secondary"> · {entry.confidence}</span>
                    ) : null}
                  </td>
                  <td className="faint">{entry.category}</td>
                  <td className="num">
                    <span className={entry.direction === 'in' ? 'delta--good' : undefined}>
                      {entry.direction === 'in' ? '+' : '−'}
                      {formatMinorAmount(entry.amount.amount, entry.amount.currency, {
                        showCurrency: false,
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- risks -- */

const SEVERITY_TONE = { low: 'neutral', medium: 'warn', high: 'deny', critical: 'deny' } as const;

function RisksPanel({ title, span, spec, ctx }: PanelProps) {
  const risks = scoped(ctx.data.risks, spec, ctx);
  return (
    <Panel title={title} span={span} flush>
      {risks.length === 0 ? (
        <Empty title="Nothing on the register">
          An empty risk register usually means nobody has looked, not that nothing is wrong.
        </Empty>
      ) : (
        <div className="list">
          {risks.map((risk) => (
            <div key={risk.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="spread">
                  <span className="list-primary">{risk.label}</span>
                  <span className="row" style={{ gap: 'var(--s-2)' }}>
                    <Badge tone="outline">{risk.kind}</Badge>
                    <Badge tone={SEVERITY_TONE[risk.severity]} dot>
                      {risk.severity}
                    </Badge>
                  </span>
                </span>
                <p className="prose">{risk.detail}</p>
                {risk.mitigation ? (
                  <p className="list-secondary">Mitigation — {risk.mitigation}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- suggestions -- */

function SuggestionsPanel({ title, span, spec, ctx }: PanelProps) {
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

function AssetsPanel({ title, span, spec, ctx }: PanelProps) {
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

function BriefsPanel({ title, span, spec, ctx }: PanelProps) {
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

function ProductsPanel({ title, span, ctx }: SimplePanelProps) {
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

function AiTeamPanel({ title, span, ctx }: SimplePanelProps) {
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

function CompanyDnaPanel({ title, span, ctx }: SimplePanelProps) {
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

function BrandDnaPanel({ title, span, ctx }: SimplePanelProps) {
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

function ExpansionPanel({ title, span, ctx }: SimplePanelProps) {
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

function PersonalDnaPanel({ title, span, ctx }: SimplePanelProps) {
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

/* ---------------------------------------------------------------- health -- */

function HealthPanel({ title, span, ctx }: SimplePanelProps) {
  const days = [...ctx.data.health].sort((a, b) => (a.date < b.date ? -1 : 1));
  const tracked = days.filter((d) => d.sleepHours !== undefined);
  const latest = tracked[tracked.length - 1];
  const week = tracked.slice(-7);

  if (!latest) {
    return (
      <Panel title={title} span={span}>
        <Empty title="Nothing logged">
          Recovery drives how the assistant plans your week. Without it, it plans blind and says so.
        </Empty>
      </Panel>
    );
  }

  const energy = energyOf(latest);
  const breakdown = deriveEnergy(latest);
  const avgSleep = week.reduce((s, d) => s + (d.sleepHours ?? 0), 0) / (week.length || 1);
  const energySeries = tracked.slice(-28).map((d) => energyOf(d) ?? 0);

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`Last logged ${formatDate(latest.date)} · ${days.length - tracked.length} untracked days in range`}
    >
      <div className="stack">
        <MetricGrid>
          <Metric
            label="Energy"
            value={energy === null ? EMPTY : formatNumber(energy)}
            hint={energyLabel(energy)}
            series={energySeries}
          />
          <Metric label="Sleep · 7-day avg" value={`${formatNumber(avgSleep, 1)}h`} hint="Target 7h" target={7} />
          <Metric label="HRV" value={formatNumber(latest.hrv)} hint="Last night" />
          <Metric label="Resting HR" value={formatNumber(latest.restingHeartRate)} hint="Last night" />
        </MetricGrid>

        <div>
          <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
            What the score is made of
          </p>
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {breakdown.contributions.map((c) => (
              <div key={c.label} className="spread">
                <span className="list-secondary">{c.label}</span>
                <span className="row" style={{ width: '9rem' }}>
                  <Meter value={c.points / c.of} label={c.label} />
                  <span className="list-meta">
                    {c.points}/{c.of}
                  </span>
                </span>
              </div>
            ))}
            {breakdown.missing.length > 0 ? (
              <p className="list-secondary">Not recorded: {breakdown.missing.join(', ')}</p>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function HabitsPanel({ title, span, ctx }: SimplePanelProps) {
  const habits = ctx.data.habits.filter((h) => !h.archived);
  return (
    <Panel title={title} span={span} flush>
      {habits.length === 0 ? (
        <Empty title="No habits tracked" />
      ) : (
        <div className="list">
          {habits.map((habit) => {
            const recent = habit.completions.filter((d) => daysBetween(d) <= 28).length;
            const expected = habit.targetPerWeek * 4;
            const adherence = expected > 0 ? Math.min(1, recent / expected) : 0;
            return (
              <div key={habit.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                  <span className="spread">
                    <span className="list-primary">{habit.name}</span>
                    <span className="list-meta">{formatPercent(adherence * 100)}</span>
                  </span>
                  <Meter
                    value={adherence}
                    label={habit.name}
                    tone={adherence > 0.75 ? 'ok' : adherence > 0.5 ? 'warn' : 'deny'}
                  />
                  <span className="list-secondary">{habit.intent}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function RelationshipsPanel({ title, span, ctx }: SimplePanelProps) {
  const circles = ['family', 'inner', 'friends', 'mentors', 'network'] as const;
  const people = ctx.data.relationships;

  return (
    <Panel
      title={title}
      span={span}
      subtitle="Cadence you chose, not a productivity metric."
    >
      {people.length === 0 ? (
        <Empty title="Nobody added yet" />
      ) : (
        <div className="stack">
          {circles.map((circle) => {
            const inCircle = people.filter((p) => p.circle === circle);
            if (inCircle.length === 0) return null;
            return (
              <div key={circle} className="stack" style={{ gap: 'var(--s-2)' }}>
                <span className="eyebrow">{circle}</span>
                <div className="chip-row">
                  {inCircle.map((person) => {
                    const since = person.lastContactAt ? daysBetween(person.lastContactAt) : null;
                    const overdue = since !== null && since > person.cadenceDays;
                    return (
                      <span key={person.id} className={overdue ? 'person person--overdue' : 'person'}>
                        <span>{person.name}</span>
                        <span className="list-meta">{since === null ? EMPTY : `${since}d`}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function LearningPanel({ title, span, ctx }: SimplePanelProps) {
  const items = ctx.data.learning;
  return (
    <Panel title={title} span={span} flush>
      {items.length === 0 ? (
        <Empty title="Nothing in progress" />
      ) : (
        <div className="list">
          {items.map((item) => (
            <div key={item.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                <span className="spread">
                  <span className="list-primary">
                    {item.title}
                    {item.author ? <span className="faint"> · {item.author}</span> : null}
                  </span>
                  <Badge tone="outline">{item.kind}</Badge>
                </span>
                <Meter value={item.progress} label={item.title} />
                <span className="list-secondary">{item.why}</span>
                {item.insights.length > 0 ? (
                  <ul className="list-secondary">
                    {item.insights.map((insight) => (
                      <li key={insight}>· {insight}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function LifeAdminPanel({ title, span, ctx }: SimplePanelProps) {
  const items = [...ctx.data.lifeAdmin]
    .filter((i) => i.status !== 'done')
    .sort((a, b) => ((a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1));
  return (
    <Panel title={title} span={span} flush>
      {items.length === 0 ? (
        <Empty title="Nothing open" />
      ) : (
        <div className="list">
          {items.map((item) => (
            <ListRow
              key={item.id}
              primary={item.title}
              secondary={item.detail ?? item.location ?? undefined}
              meta={formatDate(item.dueDate)}
              trailing={<Badge tone="outline">{item.kind}</Badge>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function CalendarPanel({ title, span, ctx }: SimplePanelProps) {
  const blocks = [...ctx.data.calendar].sort((a, b) =>
    a.date === b.date ? a.startMinute - b.startMinute : a.date < b.date ? -1 : 1,
  );
  const days = [...new Set(blocks.map((b) => b.date))].slice(0, 7);

  return (
    <Panel title={title} span={span} flush>
      {days.length === 0 ? (
        <Empty title="Nothing scheduled" />
      ) : (
        <div className="list">
          {days.map((day) => (
            <div key={day} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="eyebrow">{formatDate(day)}</span>
                {blocks
                  .filter((b) => b.date === day)
                  .map((block) => (
                    <span key={block.id} className="spread">
                      <span className="list-primary">{block.title}</span>
                      <span className="list-meta">{formatDurationMinutes(block.durationMinutes)}</span>
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- memory -- */

function MemoryPanel({ title, span, spec, ctx }: PanelProps) {
  const own = scoped(ctx.data.memory, spec, ctx);
  const owner = spec.capabilityId ?? ctx.capabilityId;
  const shared = (ctx.sharedMemory ?? []).filter(
    (m) => spec.capabilityFilter === 'all' || m.capabilityId === owner,
  );

  return (
    <Panel title={title} span={span} flush>
      {own.length === 0 && shared.length === 0 ? (
        <Empty title="Nothing learned yet" />
      ) : (
        <div className="list">
          {own.map((record) => (
            <ListRow
              key={record.id}
              primary={record.text}
              secondary={record.kind}
              meta={formatPercent(record.strength * 100)}
            />
          ))}
          {shared.map((record) => (
            <ListRow
              key={record.id}
              primary={record.text}
              secondary={`${record.kind} · shared across every space`}
              trailing={<Badge tone="info">shared</Badge>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export { Spark };
