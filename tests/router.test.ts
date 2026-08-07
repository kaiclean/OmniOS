import { describe, expect, it } from 'vitest';

import { buildDelegationPlan, route, scoreSpecialists } from '@/lib/ai/router';
import { SPECIALISTS, getSpecialist, specialistsForCapability } from '@/lib/ai/specialists';
import { CAPABILITIES } from '@/lib/capabilities/registry';

const BOTH = ['company', 'personal'] as const;

describe('specialist registry', () => {
  it('has unique ids', () => {
    const ids = SPECIALISTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only claims capabilities that exist', () => {
    const known = new Set(CAPABILITIES.map((c) => c.id));
    for (const specialist of SPECIALISTS) {
      for (const id of specialist.capabilityIds) {
        expect(known.has(id), `${specialist.id} claims unknown capability "${id}"`).toBe(true);
      }
    }
  });

  it('gives every capability at least one specialist', () => {
    for (const capability of CAPABILITIES) {
      expect(
        specialistsForCapability(capability.id).length,
        `no specialist covers "${capability.id}"`,
      ).toBeGreaterThan(0);
    }
  });

  it('names only specialists that exist in each capability', () => {
    for (const capability of CAPABILITIES) {
      for (const id of capability.specialistIds) {
        expect(getSpecialist(id), `capability ${capability.id} names unknown specialist ${id}`).toBeDefined();
      }
    }
  });

  it('allows every specialist in at least one scope kind', () => {
    for (const specialist of SPECIALISTS) {
      expect(specialist.allowedScopeKinds.length).toBeGreaterThan(0);
    }
  });
});

describe('routing', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['How is cash flow looking this quarter?', 'cfo'],
    ['What should I do today?', 'chief-of-staff'],
    ['I slept badly all week and feel tired', 'health'],
    ['Draft a campaign for the launch', 'marketer'],
    ['Which deals in the pipeline are worth chasing?', 'sales'],
    ['There is a bug in the deployment', 'engineer'],
    ['Review the contract terms before I sign', 'legal'],
    ['Automate the weekly report', 'automation'],
    ['Research the competitive landscape', 'researcher'],
    ["I haven't called my family in weeks", 'life-coach'],
  ];

  for (const [prompt, expected] of cases) {
    it(`routes "${prompt}" to ${expected}`, () => {
      expect(route(prompt, BOTH).lead.id).toBe(expected);
    });
  }

  it('falls back to the Chief of Staff when nothing matches', () => {
    const result = route('zzzz qqqq', BOTH);
    expect(result.lead.id).toBe('chief-of-staff');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('never routes a health question inside a company scope to the health specialist', () => {
    const result = route('I slept badly all week', ['company']);
    expect(result.lead.allowedScopeKinds).toContain('company');
    expect(result.lead.id).not.toBe('health');
  });

  it('excludes personal-only specialists from company scoring entirely', () => {
    const scored = scoreSpecialists('call my family about the holiday', ['company']);
    expect(scored.every((s) => s.specialist.allowedScopeKinds.includes('company'))).toBe(true);
  });

  it('is deterministic', () => {
    const a = route('How is cash flow?', BOTH);
    const b = route('How is cash flow?', BOTH);
    expect(a.lead.id).toBe(b.lead.id);
    expect(a.confidence).toBe(b.confidence);
  });

  it('scores a multi-word phrase above an incidental keyword', () => {
    const scored = scoreSpecialists('what is our cash flow situation', BOTH);
    expect(scored[0]?.specialist.id).toBe('cfo');
  });

  it('keeps confidence inside 0..1', () => {
    for (const [prompt] of cases) {
      const { confidence } = route(prompt, BOTH);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('adds supporting specialists only when they score close to the lead', () => {
    const result = route('marketing campaign budget and pricing', BOTH);
    expect(result.supporting.length).toBeLessThanOrEqual(2);
    expect(result.supporting.every((s) => s.id !== result.lead.id)).toBe(true);
  });
});

describe('delegation plans', () => {
  const routing = route('How is cash flow looking?', BOTH);

  const plan = (prompt: string) =>
    buildDelegationPlan({
      prompt,
      routing: route(prompt, BOTH),
      contextUsed: [{ kind: 'kpi', id: 'k1', label: 'Runway', scopeKey: 'company:x' }],
      summary: 'summary',
      outputs: new Map(),
    });

  it('produces one step per consulted specialist', () => {
    const built = buildDelegationPlan({
      prompt: 'How is cash flow looking?',
      routing,
      contextUsed: [],
      summary: 's',
      outputs: new Map(),
    });
    expect(built.steps).toHaveLength(1 + routing.supporting.length);
    expect(built.steps[0]?.specialistId).toBe(routing.lead.id);
  });

  it('requires approval when a step would act outside OmniOS', () => {
    const built = plan('Send the invoice reminder to the client');
    expect(built.requiresApproval).toBe(true);
    expect(built.approvalReason).toBeTruthy();
    expect(built.steps.some((s) => s.status === 'needs-approval')).toBe(true);
  });

  it('does not require approval for a read-only question', () => {
    const built = plan('How is cash flow looking?');
    expect(built.requiresApproval).toBe(false);
    expect(built.approvalReason).toBeUndefined();
  });

  it('carries the context references it was given', () => {
    const built = plan('How is cash flow looking?');
    expect(built.contextUsed).toHaveLength(1);
    expect(built.contextUsed[0]?.label).toBe('Runway');
  });

  it('gives every step a unique id', () => {
    const built = plan('marketing campaign budget and pricing strategy');
    const ids = built.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the suggestions OmniOS offers before the founder types', () => {
  it('all reach a real specialist rather than the empty fallback', async () => {
    const { ASSISTANT_SUGGESTIONS, COMPANY_SUGGESTIONS } = await import('@/lib/ai/prompts');
    for (const prompt of ASSISTANT_SUGGESTIONS) {
      expect(scoreSpecialists(prompt, BOTH).length, `"${prompt}" matched nobody`).toBeGreaterThan(0);
    }
    for (const prompt of COMPANY_SUGGESTIONS) {
      expect(
        scoreSpecialists(prompt, ['company']).length,
        `"${prompt}" matched nobody in a company`,
      ).toBeGreaterThan(0);
    }
  });

  it('routes each founder-level suggestion to a distinct area of the system', () => {
    const leads = [
      'What should I do today?',
      'How is cash flow across everything?',
      'Who have I not spoken to in too long?',
    ].map((prompt) => route(prompt, BOTH).lead.domain);
    expect(new Set(leads).size).toBe(leads.length);
  });
});
