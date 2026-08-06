import { describe, expect, it } from 'vitest';

import { generateCompanyWorkspace } from '@/lib/generation/company-hq';
import { generatePersonalWorkspace } from '@/lib/generation/personal-hq';
import { buildEmptyWorkspace, buildInitialWorkspace, SAMPLE_COMPANY_DRAFTS } from '@/lib/data/seed';
import { capabilitiesFor } from '@/lib/capabilities/registry';
import { COLLECTION_NAMES } from '@/lib/data/schema';
import type { CompanyDraft } from '@/lib/domain';

const NOW = new Date('2026-03-14T09:00:00.000Z');

const DRAFT: CompanyDraft = {
  name: 'Aurora Metalworks',
  description: 'Precision metal fabrication for small production runs.',
  industry: 'Manufacturing',
  mission: 'Make short-run fabrication as reliable as mass production.',
  vision: 'The default shop for teams who need fifty perfect parts, not fifty thousand.',
  businessModel: 'Per-run pricing with a maintenance retainer.',
  goals: ['Ten repeat customers', 'Cover fixed costs from retainers'],
  stage: 'building',
  baseCurrency: 'CHF',
};

describe('company headquarters generation', () => {
  it('is deterministic for the same draft', () => {
    const a = generateCompanyWorkspace(DRAFT, NOW);
    const b = generateCompanyWorkspace(DRAFT, NOW);
    expect(a).toEqual(b);
  });

  it('gives different companies different ids and content', () => {
    const a = generateCompanyWorkspace(DRAFT, NOW);
    const b = generateCompanyWorkspace({ ...DRAFT, name: 'Borealis Metalworks' }, NOW);
    expect(a.company.id).not.toBe(b.company.id);
    expect(a.data.kpis[0]?.value).not.toBe(b.data.kpis[0]?.value);
  });

  it('produces a readable id derived from the name', () => {
    const { company } = generateCompanyWorkspace(DRAFT, NOW);
    expect(company.id.startsWith('aurora-metalworks-')).toBe(true);
  });

  it('handles names with umlauts and punctuation', () => {
    const { company } = generateCompanyWorkspace(
      { ...DRAFT, name: 'ALL Rückbau 24 GmbH & Co.' },
      NOW,
    );
    expect(company.id).toMatch(/^all-ruckbau-24-gmbh-co-[a-z0-9]{4}$/);
  });

  it('carries the founder-supplied fields through verbatim', () => {
    const { company } = generateCompanyWorkspace(DRAFT, NOW);
    expect(company.dna.mission).toBe(DRAFT.mission);
    expect(company.dna.vision).toBe(DRAFT.vision);
    expect(company.dna.businessModel).toBe(DRAFT.businessModel);
    expect(company.industry).toBe(DRAFT.industry);
  });

  it('turns each founder goal into a real goal record', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    for (const goal of DRAFT.goals) {
      expect(data.goals.some((g) => g.title === goal)).toBe(true);
    }
  });

  it('populates every collection a company headquarters needs', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    const required = [
      'goals',
      'kpis',
      'tasks',
      'roadmap',
      'automations',
      'docs',
      'contacts',
      'finance',
      'risks',
      'suggestions',
      'memory',
      'briefs',
      'assets',
    ] as const;
    for (const key of required) {
      expect(data[key].length, `expected ${key} to be populated`).toBeGreaterThan(0);
    }
  });

  it('leaves personal-only collections empty for a company', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    for (const key of ['health', 'habits', 'relationships', 'learning', 'lifeAdmin'] as const) {
      expect(data[key], `expected ${key} to stay empty`).toEqual([]);
    }
  });

  it('scopes every generated record to the new company', () => {
    const { company, data } = generateCompanyWorkspace(DRAFT, NOW);
    for (const name of COLLECTION_NAMES) {
      for (const record of data[name]) {
        expect(record.scope).toEqual({ kind: 'company', companyId: company.id });
      }
    }
  });

  it('gives every record a unique id', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    const ids = COLLECTION_NAMES.flatMap((name) => data[name].map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('grants every company capability by default', () => {
    const { company } = generateCompanyWorkspace(DRAFT, NOW);
    expect(company.disabledCapabilityIds).toEqual([]);
    expect(capabilitiesFor('company', company.disabledCapabilityIds).length).toBeGreaterThan(8);
  });

  it('only references capabilities that exist in the registry', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    const known = new Set(capabilitiesFor('company').map((c) => c.id));
    const referenced = [
      ...data.goals.map((g) => g.capabilityId),
      ...data.kpis.map((k) => k.capabilityId),
      ...data.tasks.map((t) => t.capabilityId),
      ...data.automations.map((a) => a.capabilityId),
      ...data.risks.map((r) => r.capabilityId),
      ...data.suggestions.map((s) => s.capabilityId),
    ];
    for (const id of referenced) {
      expect(known.has(id), `unknown capability "${id}"`).toBe(true);
    }
  });

  it('marks every recommendation as simulated', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    expect(data.suggestions.every((s) => s.simulated)).toBe(true);
    expect(data.assets.every((a) => a.simulated)).toBe(true);
  });

  it('flags automations that would act outside OmniOS as needing approval', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    for (const automation of data.automations) {
      const external = automation.steps.some((s) => s.external);
      expect(automation.requiresApproval).toBe(external);
    }
  });

  it('never records a fractional minor-unit amount', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    for (const entry of data.finance) {
      expect(Number.isInteger(entry.amount.amount)).toBe(true);
    }
  });

  it('produces both actual and forecast ledger entries', () => {
    const { data } = generateCompanyWorkspace(DRAFT, NOW);
    const kinds = new Set(data.finance.map((e) => e.confidence));
    expect(kinds.has('actual')).toBe(true);
    expect(kinds.has('forecast')).toBe(true);
  });
});

describe('personal headquarters generation', () => {
  it('is deterministic', () => {
    expect(generatePersonalWorkspace('Kai', [], NOW)).toEqual(
      generatePersonalWorkspace('Kai', [], NOW),
    );
  });

  it('populates the life-specific collections', () => {
    const { data } = generatePersonalWorkspace('Kai', [], NOW);
    for (const key of ['health', 'habits', 'relationships', 'learning', 'lifeAdmin', 'calendar'] as const) {
      expect(data[key].length, `expected ${key} to be populated`).toBeGreaterThan(0);
    }
  });

  it('scopes every record to personal life', () => {
    const { data } = generatePersonalWorkspace('Kai', [], NOW);
    for (const name of COLLECTION_NAMES) {
      for (const record of data[name]) {
        expect(record.scope).toEqual({ kind: 'personal' });
      }
    }
  });

  it('leaves untracked health days genuinely empty rather than zeroed', () => {
    const { data } = generatePersonalWorkspace('Kai', [], NOW);
    const untracked = data.health.filter((d) => d.notes === 'Not tracked');
    expect(untracked.length).toBeGreaterThan(0);
    for (const day of untracked) {
      expect(day.sleepHours).toBeUndefined();
      expect(day.energy).toBeUndefined();
    }
  });

  it('only references capabilities available to personal life', () => {
    const { data } = generatePersonalWorkspace('Kai', [], NOW);
    const known = new Set(capabilitiesFor('personal').map((c) => c.id));
    for (const id of [
      ...data.goals.map((g) => g.capabilityId),
      ...data.kpis.map((k) => k.capabilityId),
      ...data.tasks.map((t) => t.capabilityId),
      ...data.suggestions.map((s) => s.capabilityId),
    ]) {
      expect(known.has(id), `unknown personal capability "${id}"`).toBe(true);
    }
  });
});

describe('initial workspace', () => {
  it('builds every sample company plus personal life and shared scopes', () => {
    const { root, scopes } = buildInitialWorkspace(NOW);
    expect(root.companies).toHaveLength(SAMPLE_COMPANY_DRAFTS.length);
    expect(scopes.some(([scope]) => scope.kind === 'personal')).toBe(true);
    expect(scopes.some(([scope]) => scope.kind === 'shared')).toBe(true);
  });

  it('marks sample companies as generated', () => {
    const { root } = buildInitialWorkspace(NOW);
    expect(root.companies.every((c) => c.generated)).toBe(true);
  });

  it('writes one scope entry per company', () => {
    const { root, scopes } = buildInitialWorkspace(NOW);
    for (const company of root.companies) {
      expect(
        scopes.some(([scope]) => scope.kind === 'company' && scope.companyId === company.id),
      ).toBe(true);
    }
  });

  it('keeps shared capability memory free of identifying detail', async () => {
    const { promotionCheck } = await import('@/lib/domain/scope');
    const { root, scopes } = buildInitialWorkspace(NOW);
    const names = root.companies.map((c) => c.name);
    for (const [scope, data] of scopes) {
      if (scope.kind !== 'shared') continue;
      for (const record of data.memory) {
        const verdict = promotionCheck(record.text, names);
        expect(verdict.allowed, `${record.text} → ${verdict.violations.join(', ')}`).toBe(true);
      }
    }
  });

  it('never applies an upgrade candidate on its own', () => {
    const { root } = buildInitialWorkspace(NOW);
    for (const candidate of root.upgrades) {
      expect(candidate.stage).not.toBe('applied');
      expect(candidate.appliedAt).toBeUndefined();
    }
  });

  it('offers an empty workspace with personal life still intact', () => {
    const { root, scopes } = buildEmptyWorkspace('Kai', NOW);
    expect(root.companies).toEqual([]);
    expect(root.personal.id).toBe('personal');
    expect(scopes).toHaveLength(1);
  });
});
