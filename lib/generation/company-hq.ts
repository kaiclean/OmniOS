/**
 * Company headquarters generation.
 *
 * This is the mechanism behind the product's central promise: a founder fills in
 * a short form, and a complete, populated headquarters exists a moment later —
 * DNA, brand, goals, KPIs, roadmap, ledger, pipeline, SOPs, automations, risks
 * and recommendations, all wired to the Capability registry.
 *
 * Everything produced here is marked `simulated` / `source: 'seed'` where it is a
 * starting point rather than an observation. The OS shows that distinction in the
 * UI: a founder should never mistake a generated placeholder for a measured fact.
 *
 * This file is the assembly only. The generators live in `./company-hq/`, grouped
 * by what they produce. Every one of them draws from the same seeded `Rng`, in
 * the order `generateCompanyWorkspace` calls them, so the same company still
 * produces the same headquarters. Split from one 924-line module; importers are
 * unchanged.
 */

import { makeId, type Company, type CompanyDraft } from '@/lib/domain';
import { emptyScopeData, type ScopeData } from '@/lib/data/schema';
import { CAPABILITIES, capabilitiesFor } from '@/lib/capabilities/registry';
import { createRng } from './rng';
import { iso, type GenCtx } from './company-hq/shared';
import { makeBrand, makeDna } from './company-hq/identity';
import {
  KPI_SEEDS,
  TASK_SEEDS,
  founderGoals,
  makeGoals,
  makeKpis,
  makeRoadmap,
  makeTasks,
} from './company-hq/planning';
import { makeAutomations, makeDocs } from './company-hq/operations';
import { makeContacts, makeFinance, makeRisks } from './company-hq/business';
import { makeCreative, makeMemory, makeSuggestions } from './company-hq/output';

/* -------------------------------------------------------------- assembly -- */

export interface GeneratedCompany {
  readonly company: Company;
  readonly data: ScopeData;
}

/**
 * Turn a founder's short draft into a complete company headquarters.
 *
 * Deterministic: the same draft always produces the same headquarters, which is
 * what makes this testable and what stops a reload from silently reshuffling a
 * founder's world.
 */
export interface GenerateOptions {
  /**
   * A real company starts from the truth: structure, DNA scaffold and the
   * founder's own goals — and not one invented record. The populated mode
   * exists to make the product legible in one glance; the clean slate exists
   * so a founder can run their actual business without fiction in the ledger.
   */
  readonly cleanSlate?: boolean;
}

export function generateCompanyWorkspace(draft: CompanyDraft, now: Date = new Date(), options: GenerateOptions = {}): GeneratedCompany {
  const companyId = makeId(draft.name, `${draft.name}:${draft.industry}`);
  const ctx: GenCtx = { rng: createRng(companyId), companyId, now, draft };

  const company: Company = {
    id: companyId,
    name: draft.name,
    shortName: draft.name.split(/\s+/)[0] ?? draft.name,
    description: draft.description,
    industry: draft.industry,
    stage: draft.stage,
    createdAt: iso(now),
    updatedAt: iso(now),
    baseCurrency: draft.baseCurrency,
    dna: makeDna(ctx),
    brand: makeBrand(ctx),
    expansion: [
      {
        id: makeId('home market', `${companyId}:exp0`),
        market: 'Home region',
        rationale: 'Prove the model where reputation travels fastest and delivery is cheapest.',
        status: 'live',
        horizon: 'Now',
      },
      {
        id: makeId('adjacent region', `${companyId}:exp1`),
        market: 'Adjacent region',
        rationale: 'Same language, same regulations, no new operating model required.',
        status: 'considering',
        horizon: 'Next 12 months',
      },
    ],
    disabledCapabilityIds: [],
    // The badge this flag drives reads "Sample workspace". A clean slate holds
    // the founder's real company — generated scaffolding, but no sample data.
    generated: !options.cleanSlate,
  };

  if (options.cleanSlate) {
    return { company, data: { ...emptyScopeData(), goals: founderGoals(ctx) } };
  }

  const { briefs, assets } = makeCreative(ctx);

  const data: ScopeData = {
    ...emptyScopeData(),
    goals: makeGoals(ctx),
    kpis: makeKpis(ctx),
    tasks: makeTasks(ctx),
    roadmap: makeRoadmap(ctx),
    automations: makeAutomations(ctx),
    docs: makeDocs(ctx),
    contacts: makeContacts(ctx),
    finance: makeFinance(ctx),
    risks: makeRisks(ctx),
    suggestions: makeSuggestions(ctx),
    memory: makeMemory(ctx),
    briefs,
    assets,
  };

  return { company, data };
}

/** Capabilities a freshly created company receives — every one that applies. */
export function grantedCapabilityIds(): string[] {
  return capabilitiesFor('company').map((c) => c.id);
}

/** Used by the create flow's preview: what the founder is about to receive. */
export function generationSummary(): Array<{ label: string; detail: string }> {
  const caps = capabilitiesFor('company');
  return [
    { label: `${caps.length} capabilities`, detail: caps.map((c) => c.name).join(' · ') },
    { label: 'Company DNA', detail: 'Mission, vision, values, audience, competitors, strategy' },
    { label: 'Brand DNA', detail: 'Voice, tone, palette, typography, imagery, guardrails' },
    { label: `${KPI_SEEDS.length} KPIs`, detail: 'Seeded across finance, growth, delivery and strategy' },
    { label: `${TASK_SEEDS.length} opening tasks`, detail: 'The work a company this age actually has' },
    { label: 'Ledger', detail: '12 months of entries — 9 actual, 3 forecast' },
    { label: 'Automations', detail: '6 templates, three armed, none touching the outside world' },
    { label: 'AI team', detail: `${CAPABILITIES.length} capability platforms staffed by specialists` },
  ];
}
