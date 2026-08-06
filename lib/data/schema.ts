/**
 * The shape of what OmniOS persists.
 *
 * Storage is partitioned by scope: one file per company, one for personal life,
 * one per shared capability. The isolation promised by `lib/domain/scope.ts` is
 * therefore physical, not just a filter someone might forget to apply.
 */

import type {
  AgentRun,
  AssistantMessage,
  Automation,
  AutomationRun,
  CalendarBlock,
  Company,
  Contact,
  CreativeAsset,
  CreativeBrief,
  Discovery,
  FinanceEntry,
  Goal,
  Habit,
  HealthDay,
  KnowledgeDoc,
  Kpi,
  LearningItem,
  LearningReport,
  LifeAdminItem,
  MemoryRecord,
  Notification,
  PersonalProfile,
  ProductSpec,
  Relationship,
  ReportSettings,
  RiskItem,
  RoadmapItem,
  Suggestion,
  Task,
  Timestamp,
  UpgradeCandidate,
} from '@/lib/domain';

/** Everything stored inside one scope. Every collection is scope-local. */
export interface ScopeData {
  tasks: Task[];
  goals: Goal[];
  kpis: Kpi[];
  roadmap: RoadmapItem[];
  automations: Automation[];
  automationRuns: AutomationRun[];
  docs: KnowledgeDoc[];
  contacts: Contact[];
  finance: FinanceEntry[];
  risks: RiskItem[];
  suggestions: Suggestion[];
  notifications: Notification[];
  memory: MemoryRecord[];
  messages: AssistantMessage[];
  agentRuns: AgentRun[];
  briefs: CreativeBrief[];
  assets: CreativeAsset[];
  products: ProductSpec[];
  health: HealthDay[];
  habits: Habit[];
  relationships: Relationship[];
  learning: LearningItem[];
  lifeAdmin: LifeAdminItem[];
  calendar: CalendarBlock[];
}

export type CollectionName = keyof ScopeData;

export const COLLECTION_NAMES: readonly CollectionName[] = [
  'tasks',
  'goals',
  'kpis',
  'roadmap',
  'automations',
  'automationRuns',
  'docs',
  'contacts',
  'finance',
  'risks',
  'suggestions',
  'notifications',
  'memory',
  'messages',
  'agentRuns',
  'briefs',
  'assets',
  'products',
  'health',
  'habits',
  'relationships',
  'learning',
  'lifeAdmin',
  'calendar',
];

export function emptyScopeData(): ScopeData {
  return {
    tasks: [],
    goals: [],
    kpis: [],
    roadmap: [],
    automations: [],
    automationRuns: [],
    docs: [],
    contacts: [],
    finance: [],
    risks: [],
    suggestions: [],
    notifications: [],
    memory: [],
    messages: [],
    agentRuns: [],
    briefs: [],
    assets: [],
    products: [],
    health: [],
    habits: [],
    relationships: [],
    learning: [],
    lifeAdmin: [],
    calendar: [],
  };
}

/** Ensures a file written by an older build still loads. Missing arrays become empty. */
export function normaliseScopeData(raw: unknown): ScopeData {
  const base = emptyScopeData();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Record<string, unknown>;
  for (const name of COLLECTION_NAMES) {
    const value = source[name];
    if (Array.isArray(value)) {
      // Records are validated at the edges (forms, generators), not on every read:
      // re-parsing thousands of records on each request buys nothing here.
      (base[name] as unknown[]) = value;
    }
  }
  return base;
}

/* --------------------------------------------------------------- root ----- */

export interface OsSettings {
  readonly theme: 'dark' | 'light' | 'system';
  readonly reduceMotion: boolean;
  readonly spaceTint: boolean;
  readonly reportSettings: ReportSettings;
  readonly assistantName: string;
}

/**
 * The workspace root — the index of spaces, plus everything that is genuinely
 * cross-space (settings, the AI ecosystem feed, upgrade candidates and reports).
 * No company or personal *content* lives here.
 */
export interface WorkspaceRoot {
  readonly version: 1;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly companies: Company[];
  readonly personal: PersonalProfile;
  readonly settings: OsSettings;
  readonly discoveries: Discovery[];
  readonly upgrades: UpgradeCandidate[];
  readonly reports: LearningReport[];
}

export const DEFAULT_SETTINGS: OsSettings = {
  theme: 'dark',
  reduceMotion: false,
  spaceTint: true,
  assistantName: 'Atlas',
  reportSettings: {
    cadence: 'weekly',
    includeHealth: true,
    includeFinance: true,
    includeEcosystem: true,
    maxBullets: 7,
  },
};
