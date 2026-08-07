/**
 * The Capability registry.
 *
 * A Capability is a reusable platform — Marketing, Finance, Operations, Health —
 * defined once and granted to every space automatically. Creating a company does
 * not create capability code; it creates a company record, and the registry
 * already knows how to render a full headquarters for it.
 *
 * Adding a capability to OmniOS means adding an entry to CAPABILITIES. Nothing
 * else in the app needs to change: navigation, routing, HQ generation, the
 * specialist router and the seeding pipeline all read from here.
 */

import type { PanelSpec } from './panels';
import { panel } from './panels';

export type SpaceKindForCapability = 'company' | 'personal';

export interface Capability {
  readonly id: string;
  readonly name: string;
  /** Shown in personal life when the business word would feel wrong. */
  readonly namePersonal?: string;
  readonly tagline: string;
  readonly description: string;
  /** Grouping used by the sidebar and the capability index. */
  readonly group: 'build' | 'grow' | 'run' | 'life' | 'intelligence';
  /** Icon key resolved by components/ui/Icon.tsx — no icon library dependency. */
  readonly icon: string;
  readonly appliesTo: readonly SpaceKindForCapability[];
  /** Panels rendered on the capability's own page inside a space. */
  readonly panels: readonly PanelSpec[];
  /** Panels this capability contributes to a space's Executive Overview. */
  readonly overviewPanels?: readonly PanelSpec[];
  readonly specialistIds: readonly string[];
  /** Ordering inside its group. */
  readonly order: number;
  /** Capabilities pinned into the primary sidebar rail. */
  readonly primaryNav?: boolean;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'strategy',
    name: 'Strategy',
    tagline: 'Where this is going and why',
    description:
      'Goals across quarter, year and decade; expansion plans; market analysis; the risks and bottlenecks that decide whether the plan survives contact with reality.',
    group: 'build',
    icon: 'compass',
    appliesTo: ['company', 'personal'],
    order: 1,
    panels: [
      panel('goals', 'Goals', 8, { capabilityFilter: 'all' }),
      panel('risks', 'Risks & bottlenecks', 4, { capabilityFilter: 'all' }),
      panel('expansion', 'Expansion', 6),
      panel('kpi-grid', 'Strategic KPIs', 6),
      panel('suggestions', 'Strategic recommendations', 12),
    ],
    overviewPanels: [panel('goals', 'Goals', 6, { capabilityFilter: 'all', limit: 4 })],
    specialistIds: ['strategist', 'analyst', 'researcher'],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    namePersonal: 'Personal brand',
    tagline: 'Attention, earned deliberately',
    description:
      'Campaigns, content calendar, channels, SEO, paid, and the brand guidelines every asset has to obey.',
    group: 'grow',
    icon: 'megaphone',
    appliesTo: ['company', 'personal'],
    order: 2,
    primaryNav: true,
    panels: [
      panel('kpi-grid', 'Marketing KPIs', 12),
      panel('tasks', 'Campaign work', 6),
      panel('briefs', 'Creative briefs', 6, { capabilityFilter: 'all' }),
      panel('assets', 'Recent assets', 6, { capabilityFilter: 'all' }),
      panel('knowledge', 'Playbooks', 6),
      panel('suggestions', 'Growth ideas', 12),
    ],
    overviewPanels: [panel('kpi-grid', 'Marketing', 6, { limit: 3 })],
    specialistIds: ['marketer', 'social', 'copywriter', 'seo'],
  },
  {
    id: 'sales',
    name: 'Sales',
    namePersonal: 'Opportunities',
    tagline: 'Pipeline, not hope',
    description: 'Contacts, pipeline stages, deal value, follow-up cadence and win/loss learning.',
    group: 'grow',
    icon: 'handshake',
    appliesTo: ['company', 'personal'],
    order: 3,
    panels: [
      panel('crm', 'Pipeline', 12, { capabilityFilter: 'all' }),
      panel('kpi-grid', 'Sales KPIs', 6),
      panel('tasks', 'Follow-ups', 6),
      panel('knowledge', 'Sales assets', 12),
    ],
    overviewPanels: [panel('crm', 'Pipeline', 6, { capabilityFilter: 'all', limit: 5 })],
    specialistIds: ['sales', 'analyst'],
  },
  {
    id: 'branding',
    name: 'Branding',
    namePersonal: 'Identity',
    tagline: 'One voice, everywhere',
    description:
      'Brand DNA — voice, tone, palette, typography, imagery and the things this brand never does.',
    group: 'grow',
    icon: 'diamond',
    appliesTo: ['company', 'personal'],
    order: 4,
    panels: [
      panel('brand-dna', 'Brand DNA', 12),
      panel('assets', 'Brand assets', 6, { capabilityFilter: 'all' }),
      panel('knowledge', 'Guidelines', 6),
    ],
    specialistIds: ['brand', 'designer', 'copywriter'],
  },
  {
    id: 'development',
    name: 'Development',
    namePersonal: 'Projects',
    tagline: 'From roadmap to shipped',
    description: 'Roadmap, features, bugs, sprints, testing and deployment.',
    group: 'build',
    icon: 'code',
    appliesTo: ['company', 'personal'],
    order: 5,
    primaryNav: true,
    panels: [
      panel('roadmap', 'Roadmap', 12),
      panel('tasks', 'Engineering work', 6),
      panel('kpi-grid', 'Delivery KPIs', 6),
      panel('ai-team', 'AI engineering team', 6),
      panel('knowledge', 'Technical docs', 6),
    ],
    overviewPanels: [panel('roadmap', 'Roadmap', 6, { limit: 4 })],
    specialistIds: ['engineer', 'architect', 'qa', 'security'],
  },
  {
    id: 'finance',
    name: 'Finance',
    namePersonal: 'Personal finance',
    tagline: 'Money, honestly counted',
    description:
      'Revenue, costs, profit, cash flow, budgets, forecasts and the anomalies worth a second look.',
    group: 'run',
    icon: 'coins',
    appliesTo: ['company', 'personal'],
    order: 6,
    primaryNav: true,
    panels: [
      panel('finance-summary', 'Position', 12, { capabilityFilter: 'all' }),
      panel('finance-ledger', 'Ledger', 8, { capabilityFilter: 'all' }),
      panel('kpi-grid', 'Financial KPIs', 4),
      panel('suggestions', 'Financial recommendations', 12),
    ],
    overviewPanels: [panel('finance-summary', 'Finance', 12, { capabilityFilter: 'all' })],
    specialistIds: ['cfo', 'analyst'],
  },
  {
    id: 'operations',
    name: 'Operations',
    namePersonal: 'Life operations',
    tagline: 'The machine that runs without you',
    description: 'Processes, SOPs, task flow, documentation and the automations that remove work.',
    group: 'run',
    icon: 'gear',
    appliesTo: ['company', 'personal'],
    order: 7,
    panels: [
      panel('tasks', 'Operational work', 6, { capabilityFilter: 'all' }),
      panel('automations', 'Automations', 6, { capabilityFilter: 'all' }),
      panel('knowledge', 'Processes & SOPs', 6),
      panel('risks', 'Bottlenecks', 6, { capabilityFilter: 'all' }),
    ],
    overviewPanels: [panel('automations', 'Automations', 6, { capabilityFilter: 'all', limit: 4 })],
    specialistIds: ['operator', 'project-manager', 'automation'],
  },
  {
    id: 'hr',
    name: 'People',
    namePersonal: 'Circle',
    tagline: 'Who does the work',
    description: 'The human and AI team, roles, responsibilities and the rituals that hold them.',
    group: 'run',
    icon: 'users',
    appliesTo: ['company'],
    order: 8,
    panels: [
      panel('ai-team', 'AI team', 12),
      panel('knowledge', 'Roles & rituals', 6),
      panel('tasks', 'People work', 6),
    ],
    specialistIds: ['operator', 'support'],
  },
  {
    id: 'legal',
    name: 'Legal',
    tagline: 'Boring until it is not',
    description: 'Contracts, obligations, compliance surface and the risks worth naming early.',
    group: 'run',
    icon: 'scale',
    appliesTo: ['company', 'personal'],
    order: 9,
    panels: [
      panel('knowledge', 'Documents & obligations', 8),
      panel('risks', 'Legal exposure', 4),
      panel('tasks', 'Legal work', 12),
    ],
    specialistIds: ['legal', 'security'],
  },
  {
    id: 'research',
    name: 'Research',
    tagline: 'Know before you commit',
    description: 'Market analysis, competitor tracking, technical investigation and open questions.',
    group: 'intelligence',
    icon: 'telescope',
    appliesTo: ['company', 'personal'],
    order: 10,
    primaryNav: true,
    panels: [
      panel('knowledge', 'Findings', 8),
      panel('memory', 'What the system learned', 4, { capabilityFilter: 'self' }),
      panel('suggestions', 'Research leads', 12),
    ],
    specialistIds: ['researcher', 'analyst'],
  },
  {
    id: 'creative',
    name: 'Creative Studio',
    tagline: 'On-brand output, on demand',
    description:
      'Briefs in, assets out — images, video, ads, decks, logos, sites and social, all bound to this space’s Brand DNA.',
    group: 'grow',
    icon: 'sparkle',
    appliesTo: ['company', 'personal'],
    order: 11,
    primaryNav: true,
    panels: [
      panel('briefs', 'Briefs', 6, { capabilityFilter: 'all' }),
      panel('assets', 'Asset library', 6, { capabilityFilter: 'all' }),
      panel('brand-dna', 'Brand DNA in force', 12),
    ],
    specialistIds: ['designer', 'video', 'photographer', 'copywriter'],
  },
  {
    id: 'automation',
    name: 'Automation',
    tagline: 'Work that does itself',
    description:
      'Templates, triggers, run history and the minutes each automation gives back. Nothing external fires without approval.',
    group: 'run',
    icon: 'bolt',
    appliesTo: ['company', 'personal'],
    order: 12,
    primaryNav: true,
    panels: [
      panel('automations', 'Automations', 12, { capabilityFilter: 'all' }),
      panel('tasks', 'Automation backlog', 6),
      panel('knowledge', 'Runbooks', 6),
    ],
    specialistIds: ['automation', 'engineer'],
  },
  {
    id: 'executive',
    name: 'Executive',
    tagline: 'The layer above all the others',
    description:
      'Priorities, decisions, conflicts between time, money, energy and health — and the reasoning behind each recommendation.',
    group: 'intelligence',
    icon: 'crown',
    appliesTo: ['company', 'personal'],
    order: 13,
    panels: [
      panel('suggestions', 'Recommendations', 8, { capabilityFilter: 'all' }),
      panel('memory', 'Decisions remembered', 4, { capabilityFilter: 'all' }),
      panel('tasks', 'Founder’s desk', 12, { capabilityFilter: 'all' }),
    ],
    specialistIds: ['chief-of-staff', 'strategist', 'analyst'],
  },
  {
    id: 'health',
    name: 'Health & performance',
    tagline: 'The engine everything else runs on',
    description: 'Sleep, recovery, training, stress, habits and the energy budget for the week.',
    group: 'life',
    icon: 'pulse',
    appliesTo: ['personal'],
    order: 14,
    panels: [
      panel('health', 'Body', 12),
      panel('habits', 'Habits', 6),
      panel('kpi-grid', 'Performance KPIs', 6),
      panel('suggestions', 'Recovery recommendations', 12),
    ],
    overviewPanels: [panel('health', 'Body', 12, { limit: 7 })],
    specialistIds: ['health', 'life-coach'],
  },
  {
    id: 'relationships',
    name: 'Relationships',
    tagline: 'The people, kept close on purpose',
    description: 'Family, inner circle, friends, mentors and network — with cadence, not guilt.',
    group: 'life',
    icon: 'heart',
    appliesTo: ['personal'],
    order: 15,
    panels: [
      panel('relationships', 'Circles', 12),
      panel('tasks', 'Reach-outs', 12),
    ],
    specialistIds: ['life-coach', 'chief-of-staff'],
  },
  {
    id: 'learning',
    name: 'Learning & growth',
    tagline: 'Compounding on purpose',
    description: 'Skills in progress, books, courses, and the insights actually applied somewhere.',
    group: 'life',
    icon: 'book',
    appliesTo: ['personal'],
    order: 16,
    panels: [
      panel('learning', 'In progress', 8),
      panel('memory', 'Insights kept', 4, { capabilityFilter: 'all' }),
      panel('knowledge', 'Notes', 12),
    ],
    specialistIds: ['researcher', 'life-coach'],
  },
  {
    id: 'life-ops',
    name: 'Life admin',
    tagline: 'The friction, handled',
    description: 'Travel, appointments, documents, renewals and the small things that eat a week.',
    group: 'life',
    icon: 'inbox',
    appliesTo: ['personal'],
    order: 17,
    panels: [
      panel('life-admin', 'Open items', 8),
      panel('calendar', 'Next seven days', 4, { capabilityFilter: 'all' }),
      panel('automations', 'Life automations', 12, { capabilityFilter: 'all' }),
    ],
    specialistIds: ['chief-of-staff', 'automation'],
  },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id: string): Capability | undefined {
  return BY_ID.get(id);
}

export function capabilityIds(): string[] {
  return CAPABILITIES.map((c) => c.id);
}

/** Capabilities available to a space kind, minus anything the space switched off. */
export function capabilitiesFor(
  spaceKind: SpaceKindForCapability,
  disabledIds: readonly string[] = [],
): Capability[] {
  return CAPABILITIES.filter(
    (c) => c.appliesTo.includes(spaceKind) && !disabledIds.includes(c.id),
  ).sort((a, b) => a.order - b.order);
}

export function capabilityLabel(
  capability: Capability,
  spaceKind: SpaceKindForCapability,
): string {
  if (spaceKind === 'personal' && capability.namePersonal) return capability.namePersonal;
  return capability.name;
}

/** Capabilities pinned to the OS-level sidebar, where they aggregate across spaces. */
export function primaryNavCapabilities(): Capability[] {
  return CAPABILITIES.filter((c) => c.primaryNav).sort((a, b) => a.order - b.order);
}

export const CAPABILITY_GROUP_LABELS: Record<Capability['group'], string> = {
  build: 'Build',
  grow: 'Grow',
  run: 'Run',
  life: 'Life',
  intelligence: 'Intelligence',
};
