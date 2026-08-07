/**
 * First-run workspace.
 *
 * OmniOS opens with a populated sample workspace rather than an empty shell,
 * because an operating system with nothing in it cannot show what it is. Every
 * generated record is marked — companies carry `generated: true`, recommendations
 * and evaluations carry `simulated: true` — and Settings offers a one-click reset
 * to an empty workspace once the founder's real spaces exist.
 */

import type { CompanyDraft, Scope } from '@/lib/domain';
import { companyScope, makeRecordId, personalScope, sharedScope } from '@/lib/domain';
import type { ScopeData, WorkspaceRoot } from './schema';
import { DEFAULT_SETTINGS, emptyScopeData } from './schema';
import { generateCompanyWorkspace } from '@/lib/generation/company-hq';
import { generatePersonalWorkspace, makePersonalProfile } from '@/lib/generation/personal-hq';
import {
  generateAllReports,
  generateDiscoveries,
  generateUpgradeCandidates,
} from '@/lib/generation/intelligence';

export const SAMPLE_COMPANY_DRAFTS: readonly CompanyDraft[] = [
  {
    name: 'Meridian Build',
    description:
      'Deconstruction and site clearance for developers who need the schedule held and the paperwork right.',
    industry: 'Construction & deconstruction',
    mission: 'Take buildings apart properly, on schedule, with nothing left for the client to chase.',
    vision:
      'The regional default for complex deconstruction — chosen because the work is documented, not because it is cheapest.',
    businessModel: 'Fixed-price projects with a maintenance retainer for repeat developers.',
    goals: [
      'Ten completed projects with documented evidence',
      'Cover fixed costs from retainers alone',
      'Operate a full delivery without the founder on site',
    ],
    stage: 'operating',
    baseCurrency: 'CHF',
  },
  {
    name: 'Northlight AI',
    description:
      'Small, sharp AI products for operators — tools that do one thing completely instead of ten things partially.',
    industry: 'AI products',
    mission: 'Turn operational knowledge into software that runs without supervision.',
    vision: 'A portfolio of small products, each profitable on its own, none requiring a team to keep alive.',
    businessModel: 'Subscription products plus a small number of build-and-hand-over engagements.',
    goals: [
      'One product with paying users and a real retention curve',
      'A repeatable build process from idea to launch in six weeks',
      'Recurring revenue above monthly burn',
    ],
    stage: 'building',
    baseCurrency: 'CHF',
  },
];

const SHARED_MEMORY_SEEDS: ReadonlyArray<[string, string, string]> = [
  [
    'marketing',
    'Proof-of-work content converts better than claims in every space it has been tried.',
    'lesson',
  ],
  [
    'sales',
    'An unpriced offer stalls conversations before they reach a quote, regardless of sector.',
    'lesson',
  ],
  [
    'operations',
    'A process executed three times without an SOP is a process that will be executed wrongly a fourth.',
    'pattern',
  ],
  [
    'finance',
    'Forecasts built on committed revenue survive contact with reality; forecasts built on pipeline do not.',
    'lesson',
  ],
  [
    'automation',
    'Automations that touch the outside world need an approval gate, or they eventually do something embarrassing.',
    'decision',
  ],
  [
    'executive',
    'Decisions made at low energy are the ones most often reversed. Defer rather than decide.',
    'pattern',
  ],
  [
    'development',
    'The smallest shippable slice teaches more than the most careful plan.',
    'lesson',
  ],
  [
    'research',
    'Separate what is known from what is assumed in writing, or the assumption becomes a fact by repetition.',
    'pattern',
  ],
];

function sharedScopeData(capabilityId: string, now: Date): ScopeData {
  const entries = SHARED_MEMORY_SEEDS.filter(([id]) => id === capabilityId);
  return {
    ...emptyScopeData(),
    memory: entries.map(([, text, kind], i) => ({
      id: makeRecordId('mem', `shared:${capabilityId}:${i}`),
      scope: sharedScope(capabilityId),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      kind: kind as 'lesson' | 'pattern' | 'decision',
      text,
      capabilityId,
      strength: 0.7,
      tags: [capabilityId, 'shared'],
      source: 'assistant' as const,
      useCount: 0,
    })),
  };
}

export interface InitialWorkspace {
  readonly root: WorkspaceRoot;
  readonly scopes: ReadonlyArray<readonly [Scope, ScopeData]>;
}

export function buildInitialWorkspace(now: Date = new Date()): InitialWorkspace {
  const generated = SAMPLE_COMPANY_DRAFTS.map((draft) => generateCompanyWorkspace(draft, now));
  const companyKeys = generated.map((g) => `company:${g.company.id}`);
  const personal = generatePersonalWorkspace('Kai', companyKeys, now);

  const discoveries = generateDiscoveries(now);
  const upgrades = generateUpgradeCandidates(discoveries, now);
  const reports = generateAllReports(discoveries, upgrades, now);

  const scopes: Array<readonly [Scope, ScopeData]> = [
    ...generated.map((g) => [companyScope(g.company.id), g.data] as const),
    [personalScope(), personal.data] as const,
    ...[...new Set(SHARED_MEMORY_SEEDS.map(([capabilityId]) => capabilityId))].map(
      (capabilityId) => [sharedScope(capabilityId), sharedScopeData(capabilityId, now)] as const,
    ),
  ];

  const root: WorkspaceRoot = {
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    companies: generated.map((g) => g.company),
    personal: personal.profile,
    settings: DEFAULT_SETTINGS,
    discoveries,
    upgrades,
    reports,
  };

  return { root, scopes };
}

/** An empty-but-valid workspace: the founder's own spaces, none of the samples. */
export function buildEmptyWorkspace(displayName = 'Kai', now: Date = new Date()): InitialWorkspace {
  const root: WorkspaceRoot = {
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    companies: [],
    personal: makePersonalProfile(displayName, now),
    settings: DEFAULT_SETTINGS,
    discoveries: [],
    upgrades: [],
    reports: [],
  };
  return { root, scopes: [[personalScope(), emptyScopeData()] as const] };
}
