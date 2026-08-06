/**
 * The AI Intelligence Center and the Safe Upgrade Pipeline.
 *
 * The rule this file exists to enforce: OmniOS never upgrades itself. It may
 * discover, analyse, sandbox, measure and recommend — and then it stops and waits
 * for a human. `UpgradeCandidate.status` can only reach `applied` through an
 * explicit founder decision recorded in {@link UpgradeDecision}.
 */

import type { ScopedRecord, Severity, Timestamp } from './work';

/* -------------------------------------------------------- discoveries ----- */

export const DISCOVERY_KINDS = [
  'model',
  'reasoning-model',
  'coding-model',
  'tool',
  'api',
  'open-source',
  'paper',
  'workflow',
  'practice',
] as const;
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];

export interface Discovery extends ScopedRecord {
  readonly title: string;
  readonly kind: DiscoveryKind;
  readonly summary: string;
  readonly sourceLabel: string;
  readonly sourceUrl?: string;
  readonly publishedAt: Timestamp;
  /** 0..100 — how much this matters to *this* founder, not to the world. */
  readonly relevance: number;
  readonly relevanceReasons: readonly string[];
  /** Which parts of OmniOS or which spaces it would touch. */
  readonly affects: readonly string[];
  readonly status: 'new' | 'triaged' | 'promoted' | 'archived';
  /** True while the feed is the bundled sample set rather than a live source. */
  readonly simulated: boolean;
}

/* ---------------------------------------------------- upgrade pipeline ---- */

export const UPGRADE_STAGES = [
  'discovered',
  'analysed',
  'sandboxed',
  'measured',
  'compared',
  'recommended',
  'awaiting-approval',
  'approved',
  'rejected',
  'extended-testing',
  'applied',
] as const;
export type UpgradeStage = (typeof UPGRADE_STAGES)[number];

/** Stages the system may reach on its own. Everything beyond needs a human. */
export const AUTONOMOUS_STAGES: readonly UpgradeStage[] = [
  'discovered',
  'analysed',
  'sandboxed',
  'measured',
  'compared',
  'recommended',
  'awaiting-approval',
];

export interface SandboxResult {
  readonly ranAt: Timestamp;
  readonly harness: string;
  readonly trials: number;
  readonly metrics: readonly SandboxMetric[];
  readonly notes: readonly string[];
  /** True when the sandbox was a deterministic local simulation. */
  readonly simulated: boolean;
}

export interface SandboxMetric {
  readonly label: string;
  readonly baseline: number;
  readonly candidate: number;
  readonly unit: string;
  readonly betterWhen: 'higher' | 'lower';
}

export const UPGRADE_DECISIONS = ['approve', 'reject', 'test-longer'] as const;
export type UpgradeDecisionKind = (typeof UPGRADE_DECISIONS)[number];

export interface UpgradeDecision {
  readonly decidedAt: Timestamp;
  readonly decision: UpgradeDecisionKind;
  readonly decidedBy: string;
  readonly note?: string;
}

export interface UpgradeCandidate extends ScopedRecord {
  readonly title: string;
  readonly discoveryId?: string;
  readonly stage: UpgradeStage;
  /** What would change, in plain language. */
  readonly whatChanged: string;
  readonly whyItMatters: string;
  readonly whatWasTested: string;
  readonly sandbox?: SandboxResult;
  readonly benefits: readonly string[];
  readonly risks: readonly UpgradeRisk[];
  readonly recommendation: string;
  readonly recommendationConfidence: number;
  readonly decision?: UpgradeDecision;
  readonly appliedAt?: Timestamp;
  readonly simulated: boolean;
}

export interface UpgradeRisk {
  readonly label: string;
  readonly severity: Severity;
  readonly mitigation: string;
}

/* --------------------------------------------------- learning reports ----- */

export const REPORT_CADENCES = ['daily', 'two-day', 'weekly', 'monthly'] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];

export interface ReportSection {
  readonly heading: string;
  readonly bullets: readonly ReportBullet[];
}

export interface ReportBullet {
  readonly text: string;
  readonly weight: 'signal' | 'context';
  readonly href?: string;
}

export interface LearningReport extends ScopedRecord {
  readonly cadence: ReportCadence;
  readonly periodStart: Timestamp;
  readonly periodEnd: Timestamp;
  readonly headline: string;
  readonly sections: readonly ReportSection[];
  readonly minutesSaved: number;
  readonly moneySavedMinor: number;
  readonly currency: string;
  readonly read: boolean;
  readonly simulated: boolean;
}

export interface ReportSettings {
  readonly cadence: ReportCadence;
  readonly includeHealth: boolean;
  readonly includeFinance: boolean;
  readonly includeEcosystem: boolean;
  readonly maxBullets: number;
}
