/**
 * The record types every space works with.
 *
 * These are deliberately shared between companies and personal life: a task is a
 * task, a goal is a goal, and money moving out of a company and money moving out
 * of a household differ in scope, not in shape. Sharing the shapes is what makes
 * a Capability renderable against either kind of space without duplication.
 */

import type { Scope } from './scope';

/** ISO-8601 date-time string. Stored as text so the JSON store round-trips cleanly. */
export type Timestamp = string;
/** ISO-8601 calendar date (`YYYY-MM-DD`). */
export type DateOnly = string;

export interface ScopedRecord {
  readonly id: string;
  readonly scope: Scope;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** Money is stored in integer minor units. No floats ever touch a balance. */
export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const CURRENCY_MINOR_UNITS: Record<CurrencyCode, number> = {
  CHF: 100,
  EUR: 100,
  USD: 100,
  GBP: 100,
};

export const money = (amount: number, currency: CurrencyCode = 'CHF'): Money => ({
  amount: Math.round(amount),
  currency,
});

/* ------------------------------------------------------------------ tasks -- */

export const TASK_STATUSES = ['backlog', 'next', 'active', 'blocked', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Energy cost. The Executive Assistant uses this to avoid stacking three deep-work
 * blocks on a day the founder slept five hours — the whole point of running life
 * and business in one system.
 */
export const ENERGY_COSTS = ['light', 'moderate', 'deep'] as const;
export type EnergyCost = (typeof ENERGY_COSTS)[number];

export const RECORD_SOURCES = ['founder', 'assistant', 'automation', 'seed'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

export interface Task extends ScopedRecord {
  readonly title: string;
  readonly notes?: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly capabilityId: string;
  readonly energy: EnergyCost;
  readonly estimateMinutes?: number;
  readonly dueDate?: DateOnly;
  readonly completedAt?: Timestamp;
  readonly goalId?: string;
  readonly source: RecordSource;
  readonly blockedReason?: string;
}

/* ------------------------------------------------------------------ goals -- */

export const GOAL_HORIZONS = ['quarter', 'year', 'three-year', 'lifetime'] as const;
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];

export const GOAL_STATUSES = ['on-track', 'at-risk', 'off-track', 'achieved', 'paused'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface Goal extends ScopedRecord {
  readonly title: string;
  readonly description?: string;
  readonly horizon: GoalHorizon;
  readonly status: GoalStatus;
  /** 0..1 */
  readonly progress: number;
  readonly targetDate?: DateOnly;
  readonly capabilityId: string;
  readonly why?: string;
}

/* -------------------------------------------------------------------- kpis -- */

export const KPI_DIRECTIONS = ['up-good', 'down-good', 'neutral'] as const;
export type KpiDirection = (typeof KPI_DIRECTIONS)[number];

export const KPI_FORMATS = ['number', 'money', 'percent', 'duration-minutes', 'score'] as const;
export type KpiFormat = (typeof KPI_FORMATS)[number];

export interface Kpi extends ScopedRecord {
  readonly label: string;
  readonly value: number;
  readonly previousValue?: number;
  readonly target?: number;
  readonly format: KpiFormat;
  readonly currency?: CurrencyCode;
  readonly direction: KpiDirection;
  readonly capabilityId: string;
  /** Oldest → newest. Drives the hairline rail under the metric, not a chart library. */
  readonly series: readonly number[];
  readonly period: string;
}

/* --------------------------------------------------------------- roadmap --- */

export const ROADMAP_STAGES = ['idea', 'planned', 'building', 'shipped', 'parked'] as const;
export type RoadmapStage = (typeof ROADMAP_STAGES)[number];

export interface RoadmapItem extends ScopedRecord {
  readonly title: string;
  readonly summary?: string;
  readonly stage: RoadmapStage;
  readonly horizon: string;
  readonly capabilityId: string;
  readonly confidence: number;
}

/* ------------------------------------------------------------ automations -- */

export const AUTOMATION_STATUSES = ['draft', 'armed', 'paused', 'failing'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const AUTOMATION_TRIGGERS = ['schedule', 'event', 'manual', 'threshold'] as const;
export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGERS)[number];

export interface AutomationStep {
  readonly id: string;
  readonly label: string;
  /** The specialist that would carry out this step once real execution is wired. */
  readonly specialistId: string;
  /** True when the step would touch anything outside OmniOS. */
  readonly external: boolean;
}

export interface Automation extends ScopedRecord {
  readonly name: string;
  readonly description: string;
  readonly capabilityId: string;
  readonly status: AutomationStatus;
  readonly trigger: AutomationTriggerKind;
  readonly triggerDetail: string;
  readonly steps: readonly AutomationStep[];
  readonly lastRunAt?: Timestamp;
  readonly runsThisMonth: number;
  readonly minutesSavedPerRun: number;
  /** V1 never performs external side effects. This records that intent explicitly. */
  readonly requiresApproval: boolean;
}

export const RUN_STATUSES = ['success', 'partial', 'failed', 'awaiting-approval'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface AutomationRunLine {
  readonly at: Timestamp;
  readonly stepId: string;
  readonly message: string;
  readonly level: 'info' | 'warn' | 'error';
}

export interface AutomationRun extends ScopedRecord {
  readonly automationId: string;
  readonly startedAt: Timestamp;
  readonly finishedAt?: Timestamp;
  readonly status: RunStatus;
  readonly lines: readonly AutomationRunLine[];
  readonly minutesSaved: number;
  /** True when the run was a local simulation rather than real execution. */
  readonly simulated: boolean;
}

/* ------------------------------------------------------------- knowledge --- */

export const DOC_KINDS = ['doc', 'sop', 'decision', 'note', 'brief'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface KnowledgeDoc extends ScopedRecord {
  readonly title: string;
  readonly body: string;
  readonly kind: DocKind;
  readonly capabilityId: string;
  readonly tags: readonly string[];
  readonly source: RecordSource;
}

/* --------------------------------------------------------------------- crm -- */

export const CRM_STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost', 'dormant'] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export interface Contact extends ScopedRecord {
  readonly name: string;
  readonly organisation?: string;
  readonly role?: string;
  readonly stage: CrmStage;
  readonly value?: Money;
  readonly lastTouchAt?: Timestamp;
  readonly nextTouchAt?: Timestamp;
  readonly notes?: string;
}

/* ----------------------------------------------------------------- finance -- */

export const FINANCE_DIRECTIONS = ['in', 'out'] as const;
export type FinanceDirection = (typeof FINANCE_DIRECTIONS)[number];

export const FINANCE_CONFIDENCE = ['actual', 'committed', 'forecast'] as const;
export type FinanceConfidence = (typeof FINANCE_CONFIDENCE)[number];

export interface FinanceEntry extends ScopedRecord {
  readonly date: DateOnly;
  readonly direction: FinanceDirection;
  readonly amount: Money;
  readonly category: string;
  readonly label: string;
  readonly confidence: FinanceConfidence;
  readonly recurring: boolean;
  readonly counterparty?: string;
  /**
   * True for ledger rows a generator invented. Money is where invariant 5 bites
   * hardest — a demo revenue figure indistinguishable from a real one turns the
   * overview strip into fiction — so the flag lives on the entry itself and
   * every rollup that sums entries reports whether fiction is included.
   */
  readonly simulated?: boolean;
}

/* ------------------------------------------------------- risks & signals --- */

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface RiskItem extends ScopedRecord {
  readonly label: string;
  readonly detail: string;
  readonly severity: Severity;
  readonly capabilityId: string;
  readonly mitigation?: string;
  readonly kind: 'risk' | 'bottleneck';
}

/* ------------------------------------------------------------ suggestions -- */

export const SUGGESTION_STATUSES = ['open', 'accepted', 'dismissed', 'done'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/**
 * A recommendation surfaced by the Executive Assistant. It always names the
 * specialist that produced it and the evidence it used, so a founder can audit
 * why the system is telling them to do something.
 */
export interface Suggestion extends ScopedRecord {
  readonly title: string;
  readonly rationale: string;
  readonly capabilityId: string;
  readonly specialistId: string;
  readonly impact: 'low' | 'medium' | 'high';
  readonly effort: 'low' | 'medium' | 'high';
  /** 0..1 — how strongly the system stands behind this. */
  readonly confidence: number;
  readonly status: SuggestionStatus;
  readonly evidence: readonly string[];
  readonly simulated: boolean;
}

/* ---------------------------------------------------------- notifications -- */

export const NOTIFICATION_LEVELS = ['info', 'attention', 'urgent'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export interface Notification extends ScopedRecord {
  readonly title: string;
  readonly detail?: string;
  readonly level: NotificationLevel;
  readonly href?: string;
  readonly read: boolean;
}
