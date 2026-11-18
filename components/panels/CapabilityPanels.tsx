/**
 * The panel renderer.
 *
 * This file is the mechanism behind the product's core claim. A Capability
 * declares a list of panel specs; this renders them against whatever space is
 * open. Nothing below knows whether it is drawing a company or a life — it
 * receives scoped records and draws them. That is why creating a company
 * produces a complete headquarters without a line of company-specific code, and
 * why adding a capability is a registry edit rather than a feature.
 *
 * This file is the dispatcher only. The renderers live in `./kinds/`, grouped by
 * what they draw, and are Server Components like this one — nothing here or
 * there is a client component. Split from one 1,196-line module; importers are
 * unchanged.
 */

import { panelTitle, type PanelSpec } from '@/lib/capabilities/panels';
import { Spark } from '@/components/ui/primitives';
import { KpiPanel, GoalsPanel, TasksPanel, RoadmapPanel, AutomationsPanel } from './kinds/work';
import {
  KnowledgePanel,
  CrmPanel,
  FinanceSummaryPanel,
  FinanceLedgerPanel,
  RisksPanel,
} from './kinds/business';
import {
  SuggestionsPanel,
  AssetsPanel,
  BriefsPanel,
  ProductsPanel,
  AiTeamPanel,
  CompanyDnaPanel,
  BrandDnaPanel,
  ExpansionPanel,
  PersonalDnaPanel,
} from './kinds/studio';
import {
  HealthPanel,
  HabitsPanel,
  RelationshipsPanel,
  LearningPanel,
  LifeAdminPanel,
  CalendarPanel,
  MemoryPanel,
} from './kinds/life';
import type { PanelContext } from './kinds/shared';

export type { PanelContext } from './kinds/shared';

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

export { Spark };
