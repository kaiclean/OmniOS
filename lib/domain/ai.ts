/**
 * The AI layer's domain types.
 *
 * OmniOS presents exactly one intelligence: the Executive Assistant. Behind it,
 * a router picks specialists and composes a delegation plan. The founder never
 * chooses an agent — but they can always *see* which ones ran and why, which is
 * the difference between an assistant and a black box.
 */

import type { Scope } from './scope';
import type { ScopedRecord, Timestamp } from './work';

/* ---------------------------------------------------------- specialists --- */

export const SPECIALIST_DOMAINS = [
  'strategy',
  'marketing',
  'sales',
  'development',
  'finance',
  'legal',
  'branding',
  'research',
  'operations',
  'project-management',
  'executive',
  'data',
  'design',
  'video',
  'photography',
  'social',
  'automation',
  'support',
  'security',
  'personal',
  'health',
] as const;
export type SpecialistDomain = (typeof SPECIALIST_DOMAINS)[number];

/**
 * A specialist agent definition.
 *
 * `matches` is what the router scores against. Keeping it declarative means new
 * specialists are added as data, not as branches in a routing function.
 */
export interface SpecialistAgent {
  readonly id: string;
  readonly name: string;
  readonly domain: SpecialistDomain;
  readonly role: string;
  /** One line the assistant can quote when it explains a delegation. */
  readonly charter: string;
  readonly capabilityIds: readonly string[];
  /** Lower-cased keywords and phrases this specialist claims. */
  readonly matches: readonly string[];
  /** Scopes this specialist may ever be invoked in. Health never runs for a company. */
  readonly allowedScopeKinds: readonly ('company' | 'personal')[];
  /** Actions it would take once real execution is wired, for the transparency panel. */
  readonly wouldDo: readonly string[];
}

/* ----------------------------------------------------------- delegation --- */

export interface DelegationStep {
  readonly id: string;
  readonly specialistId: string;
  readonly objective: string;
  /** 0..1 — the router's confidence that this specialist is the right one. */
  readonly confidence: number;
  readonly status: 'planned' | 'running' | 'done' | 'skipped' | 'needs-approval';
  readonly output?: string;
  readonly durationMs?: number;
}

export interface DelegationPlan {
  readonly intent: string;
  readonly summary: string;
  readonly steps: readonly DelegationStep[];
  /** Records used to answer, so the founder can audit the basis of a recommendation. */
  readonly contextUsed: readonly ContextReference[];
  readonly requiresApproval: boolean;
  readonly approvalReason?: string;
}

export interface ContextReference {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly scopeKey: string;
}

/* ------------------------------------------------------------ assistant --- */

export const MESSAGE_ROLES = ['founder', 'assistant'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface AssistantMessage extends ScopedRecord {
  readonly role: MessageRole;
  readonly text: string;
  readonly at: Timestamp;
  /** Present on assistant turns. The founder can expand it; it is never forced on them. */
  readonly plan?: DelegationPlan;
  /** True when produced by the local simulator rather than a real model. */
  readonly simulated: boolean;
  readonly providerId: string;
  /**
   * Which conversation this message belongs to. Absent = the main assistant
   * thread (every message written before this field existed). `agent:<id>` is a
   * direct conversation with one roster member, kept in the same scope but never
   * mixed into the assistant's history.
   */
  readonly channel?: string;
}

export interface AgentRun extends ScopedRecord {
  readonly prompt: string;
  readonly startedAt: Timestamp;
  readonly finishedAt: Timestamp;
  readonly plan: DelegationPlan;
  readonly providerId: string;
  readonly simulated: boolean;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
}

/* --------------------------------------------------------------- memory --- */

export const MEMORY_KINDS = [
  'fact',
  'preference',
  'decision',
  'lesson',
  'pattern',
  'style',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * One remembered thing.
 *
 * `scope` decides who can ever read it. A record in a company scope is invisible
 * to every other space, forever. Promotion into a shared capability scope is an
 * explicit, gated act — see {@link promotionCheck} in ./scope.
 */
export interface MemoryRecord extends ScopedRecord {
  readonly kind: MemoryKind;
  readonly text: string;
  readonly capabilityId: string;
  /** 0..1 — decays over time unless reinforced. */
  readonly strength: number;
  readonly tags: readonly string[];
  readonly source: 'founder' | 'assistant' | 'observation';
  readonly lastUsedAt?: Timestamp;
  readonly useCount: number;
  /** Set when this record was generalised from a scoped one. */
  readonly promotedFromScopeKey?: string;
  /**
   * Placeholder for a future embedding. Kept on the record so a vector index can
   * be built later without a migration of the record shape itself.
   */
  readonly embedding?: readonly number[];
}

export interface MemoryQuery {
  readonly scope: Scope;
  readonly text?: string;
  readonly kinds?: readonly MemoryKind[];
  readonly capabilityId?: string;
  readonly limit?: number;
}

/* ------------------------------------------------------------ providers --- */

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface LlmResponse {
  readonly text: string;
  readonly providerId: string;
  /** True when no real model was called. Surfaced in the UI, never hidden. */
  readonly simulated: boolean;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
}

/**
 * The one seam a real model plugs into.
 *
 * V1 ships {@link SimulatedProvider}. Setting `ANTHROPIC_API_KEY` swaps in a real
 * one without any caller changing — the router, specialists and UI are unaware.
 */
/** A tool offered to a model, in the JSON-Schema shape function-calling expects. */
export interface LlmToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface LlmToolCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface LlmToolResponse {
  readonly text: string;
  readonly calls: readonly LlmToolCall[];
  readonly tokensIn?: number;
  readonly tokensOut?: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly simulated: boolean;
  /** The secret this provider looks for by name, or null if it needs none. */
  readonly keyName: string | null;
  /** Async because a key may live in the vault, which is on disk and encrypted. */
  available(): Promise<boolean>;
  complete(request: LlmRequest): Promise<LlmResponse>;
  /**
   * Function-calling, where the provider supports it. The model may only ever
   * *plan* a call — everything it returns goes through validation and the
   * approval gate exactly like typed input, which is why this method is safe
   * to offer at all.
   */
  completeWithTools?(request: LlmRequest, tools: readonly LlmToolSchema[]): Promise<LlmToolResponse>;
}
