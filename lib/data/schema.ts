/**
 * The shape of what OmniOS persists.
 *
 * Storage is partitioned by scope: one file per company, one for personal life,
 * one per shared capability. The isolation promised by `lib/domain/scope.ts` is
 * therefore physical, not just a filter someone might forget to apply.
 */

import { DEFAULT_TELEGRAM_CONFIG } from '@/lib/domain';
import type {
  AgentRun,
  CustomAgent,
  CurrencyCode,
  McpAutonomy,
  McpConnectionState,
  McpServerConfig,
  Meeting,
  PermissionGrant,
  EvolutionEvent,
  Observation,
  RoutingHint,
  SpecialistScore,
  ToolCall,
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
  TelegramConfig,
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
  /* --- the acting and learning layers ------------------------------------ */
  toolCalls: ToolCall[];
  observations: Observation[];
  evolution: EvolutionEvent[];
  routingHints: RoutingHint[];
  specialistScores: SpecialistScore[];
  customAgents: CustomAgent[];
  meetings: Meeting[];
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
  'toolCalls',
  'observations',
  'evolution',
  'routingHints',
  'specialistScores',
  'customAgents',
  'meetings',
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
    toolCalls: [],
    observations: [],
    evolution: [],
    routingHints: [],
    specialistScores: [],
    customAgents: [],
    meetings: [],
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
  /** How the assistant writes. Affects wording only — never which facts it uses. */
  readonly assistantTone: AssistantTone;
  /**
   * Which brain the assistant thinks with.
   *
   * `'auto'` keeps first-available-wins. Naming a provider pins it, which is the
   * only way to choose a *specific* model when several keys are in the vault —
   * registry order is a sensible default but it is not a preference, and a
   * founder who put an Ollama key in because they want that model should not be
   * silently handed a different one.
   */
  readonly assistantProvider: string;
  /** Money is stored in minor units; this decides the default it is rendered in. */
  readonly currency: CurrencyCode;
  /** Local hours the founder wants work scheduled into. */
  readonly workdayStartHour: number;
  readonly workdayEndHour: number;
  /**
   * The autonomy a newly connected MCP server starts at. A default, not a
   * ceiling — each server carries its own setting once it exists.
   */
  readonly defaultMcpAutonomy: McpAutonomy;
  /**
   * Require approval for `write` tools too.
   *
   * This knob only tightens. There is deliberately no counterpart that loosens
   * `destructive` or `external`, because invariant 2 is not a preference.
   */
  readonly confirmWrites: boolean;
  /** Capabilities the founder has switched off. Hidden from navigation and routing. */
  readonly disabledCapabilityIds: readonly string[];
}

export const ASSISTANT_TONES = ['direct', 'warm', 'analytical'] as const;
export type AssistantTone = (typeof ASSISTANT_TONES)[number];

export const TONE_INSTRUCTION: Record<AssistantTone, string> = {
  direct: 'Direct and terse. Lead with the answer. No preamble, no hedging, no closing summary.',
  warm: 'Plain and human. Still brief, but write like a colleague who knows the founder, not a terminal.',
  analytical:
    'Analytical. Show the reasoning that connects the figures to the conclusion, and name what would change it.',
};

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
  /**
   * Connections to the world outside the workspace.
   *
   * They sit in the root rather than in a scope because a connection is the
   * founder's, not a company's: the same GitHub server serves every space they
   * grant it to. Scope isolation is unaffected — a *tool call* still names a
   * scope, and its result is written there and nowhere else.
   */
  readonly mcpServers: McpServerConfig[];
  /** Last probe result per server. A cache of a network fact, never authority. */
  readonly mcpStates: McpConnectionState[];
  /**
   * Approvals recorded in advance: narrow, revocable, optionally expiring.
   * Root-level like the connections they scope to — but a call made under one
   * is still recorded in its space, carrying the grant id.
   */
  readonly grants: PermissionGrant[];
  /** The remote decision channel. Absent on every workspace that predates it. */
  readonly telegram: TelegramConfig;
  /**
   * Last authorised /api/health hit — how the 12-hour heartbeat proves the
   * tunnel and the server are alive. Null until the first beat, and rendered
   * as an em dash then, never a fake date.
   */
  readonly lastHeartbeatAt: Timestamp | null;
}

export const DEFAULT_SETTINGS: OsSettings = {
  theme: 'dark',
  reduceMotion: false,
  spaceTint: true,
  assistantName: 'Atlas',
  assistantTone: 'direct',
  assistantProvider: 'auto',
  currency: 'CHF',
  workdayStartHour: 9,
  workdayEndHour: 18,
  defaultMcpAutonomy: 'ask-always',
  confirmWrites: false,
  disabledCapabilityIds: [],
  reportSettings: {
    cadence: 'weekly',
    includeHealth: true,
    includeFinance: true,
    includeEcosystem: true,
    maxBullets: 7,
  },
};

/**
 * Load a root file written by an older build.
 *
 * The root is read as raw JSON, so every field added after a founder's first run
 * arrives `undefined` no matter what the type says. Filling the gaps here is the
 * difference between a new feature appearing and the app crashing on a file that
 * predates it.
 */
export function normaliseRoot(raw: WorkspaceRoot): WorkspaceRoot {
  return {
    ...raw,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    companies: raw.companies ?? [],
    discoveries: raw.discoveries ?? [],
    upgrades: raw.upgrades ?? [],
    reports: raw.reports ?? [],
    mcpServers: raw.mcpServers ?? [],
    mcpStates: raw.mcpStates ?? [],
    grants: raw.grants ?? [],
    // Spread over the default so a config written before a field existed gains it
    // rather than arriving half-formed — the root is raw JSON, not a validated type.
    telegram: { ...DEFAULT_TELEGRAM_CONFIG, ...(raw.telegram ?? {}) },
    lastHeartbeatAt: raw.lastHeartbeatAt ?? null,
  };
}
