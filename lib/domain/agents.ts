/**
 * Custom agents and their presets.
 *
 * The built-in roster in `lib/ai/specialists.ts` covers the domains a founder
 * usually has. It cannot cover the ones they invent. A preset is a filled-in
 * starting point — charter, phrases it claims, capabilities it staffs, tools it
 * may call — so adding "Podcast Producer" is choosing a template and naming it,
 * not authoring a specialist from scratch and getting the routing wrong.
 *
 * A custom agent is stored data merged with the built-ins at read time. That
 * ordering matters: a founder can override a built-in's charter or narrow its
 * tools without editing code, and the built-in remains the fallback if they
 * later delete the override.
 */

import type { SpecialistAgent, SpecialistDomain } from './ai';
import type { ScopedRecord, Timestamp } from './work';

export interface AgentPreset {
  readonly id: string;
  readonly name: string;
  readonly domain: SpecialistDomain;
  readonly role: string;
  readonly charter: string;
  readonly summary: string;
  readonly capabilityIds: readonly string[];
  readonly matches: readonly string[];
  readonly toolIds: readonly string[];
  readonly allowedScopeKinds: readonly ('company' | 'personal')[];
  readonly wouldDo: readonly string[];
  /** Grouping for the preset picker. */
  readonly group: 'business' | 'creative' | 'technical' | 'personal' | 'operations';
}

export interface CustomAgent extends ScopedRecord {
  readonly name: string;
  readonly domain: SpecialistDomain;
  readonly role: string;
  readonly charter: string;
  readonly capabilityIds: readonly string[];
  readonly matches: readonly string[];
  readonly toolIds: readonly string[];
  readonly allowedScopeKinds: readonly ('company' | 'personal')[];
  readonly wouldDo: readonly string[];
  /** The preset it started from, kept so the UI can show what was customised. */
  readonly presetId?: string;
  /**
   * Set when this record overrides a built-in specialist of the same id rather
   * than adding a new one.
   */
  readonly overridesBuiltIn: boolean;
  readonly enabled: boolean;
  readonly createdBy: 'founder' | 'assistant';
}

/** A built-in switched off for a space, without deleting anything. */
export interface AgentToggle {
  readonly specialistId: string;
  readonly enabled: boolean;
  readonly changedAt: Timestamp;
}

export function agentIdFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** The routing-facing view of a stored agent. Extra fields stay behind. */
export function toSpecialist(agent: CustomAgent): SpecialistAgent {
  return {
    id: agent.id,
    name: agent.name,
    domain: agent.domain,
    role: agent.role,
    charter: agent.charter,
    capabilityIds: agent.capabilityIds,
    matches: agent.matches,
    allowedScopeKinds: agent.allowedScopeKinds,
    wouldDo: agent.wouldDo,
  };
}

/**
 * The roster one scope actually has.
 *
 * An enabled override replaces its built-in; a *disabled* override hides it —
 * that is how a founder switches a built-in off without deleting anything, and
 * deleting the override brings the built-in straight back. New agents append in
 * built-in order first, then by name, so the roster is stable across reloads.
 */
export function mergeRoster(
  builtIns: readonly SpecialistAgent[],
  customAgents: readonly CustomAgent[],
): SpecialistAgent[] {
  const overrides = new Map(customAgents.filter((a) => a.overridesBuiltIn).map((a) => [a.id, a]));
  const roster: SpecialistAgent[] = [];

  for (const builtIn of builtIns) {
    const override = overrides.get(builtIn.id);
    if (!override) {
      roster.push(builtIn);
    } else if (override.enabled) {
      roster.push(toSpecialist(override));
    }
    // A disabled override contributes nothing: the built-in is switched off.
  }

  const additions = customAgents
    .filter((agent) => !agent.overridesBuiltIn && agent.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const agent of additions) {
    if (!roster.some((existing) => existing.id === agent.id)) roster.push(toSpecialist(agent));
  }

  return roster;
}
