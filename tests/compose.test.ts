import { describe, expect, it } from 'vitest';

import { compose } from '@/lib/ai/compose';
import { route } from '@/lib/ai/router';
import type { AssistantContext, SpaceSlice } from '@/lib/ai/context';
import { generateCompanyWorkspace } from '@/lib/generation/company-hq';
import { generatePersonalWorkspace } from '@/lib/generation/personal-hq';
import { SAMPLE_COMPANY_DRAFTS } from '@/lib/data/seed';

const NOW = new Date('2026-03-14T09:00:00.000Z');

const draft = SAMPLE_COMPANY_DRAFTS[0];
if (!draft) throw new Error('sample company drafts are empty');

const generated = generateCompanyWorkspace(draft, NOW);
const personal = generatePersonalWorkspace('Kai', [], NOW);

const companySlice: SpaceSlice = {
  scopeKey: `company:${generated.company.id}`,
  label: generated.company.name,
  spaceKind: 'company',
  data: generated.data,
};

const personalSlice: SpaceSlice = {
  scopeKey: 'personal',
  label: 'Kai',
  spaceKind: 'personal',
  data: personal.data,
};

function context(slices: SpaceSlice[]): AssistantContext {
  return {
    target: slices.length > 1 ? { kind: 'founder' } : { kind: 'space', scope: slices[0]?.spaceKind === 'personal' ? { kind: 'personal' } : { kind: 'company', companyId: generated.company.id } },
    slices,
    sharedMemory: [],
    companies: [generated.company],
    personal: personal.profile,
    now: NOW,
  };
}

const answer = (prompt: string, slices: SpaceSlice[], kinds: ReadonlyArray<'company' | 'personal'>) =>
  compose(context(slices), prompt, route(prompt, kinds));

describe('the local reasoning engine', () => {
  it('answers from real records rather than a template', () => {
    const result = answer('How is cash flow looking?', [companySlice], ['company']);
    // The ledger has twelve months of entries; the answer must reflect them.
    expect(result.body).toContain('CHF');
    expect(result.summary).toMatch(/ledger entr/);
    expect(result.body.length).toBeGreaterThan(200);
  });

  it('is deterministic for the same records and prompt', () => {
    const a = answer('How is cash flow looking?', [companySlice], ['company']);
    const b = answer('How is cash flow looking?', [companySlice], ['company']);
    expect(a.body).toBe(b.body);
  });

  it('plans the day against the energy budget, not against everything open', () => {
    const result = answer('What should I do today?', [companySlice, personalSlice], [
      'company',
      'personal',
    ]);
    expect(result.body).toMatch(/energy/i);
    expect(result.body).toContain('What I would do today');
    // It must pick a handful, not dump the backlog.
    const picked = result.body.split('\n').filter((line) => line.startsWith('• '));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(8);
  });

  it('reads recovery and converts it into an honest ceiling', () => {
    const result = answer('How has my recovery been?', [personalSlice], ['personal']);
    expect(result.body).toMatch(/Average sleep/);
    expect(result.body).toMatch(/deep work/i);
  });

  it('says so plainly when there is no health data at all', () => {
    const empty: SpaceSlice = { ...personalSlice, data: { ...personalSlice.data, health: [] } };
    const result = answer('How has my recovery been?', [empty], ['personal']);
    expect(result.body).toMatch(/nothing logged yet|nothing honest/i);
    expect(result.body).not.toMatch(/\b0\/100\b/);
  });

  it('names the people past the cadence the founder chose', () => {
    const result = answer('Who have I not spoken to in too long?', [personalSlice], ['personal']);
    expect(result.body).toMatch(/cadence/i);
  });

  it('finds where the pipeline is leaking', () => {
    const result = answer('How is the sales pipeline?', [companySlice], ['company']);
    expect(result.body).toMatch(/open conversation/);
    expect(result.body).toMatch(/Read/);
  });

  it('reports automation time actually returned, not time theoretically available', () => {
    const result = answer('What could be automated?', [companySlice], ['company']);
    expect(result.body).toMatch(/armed/);
    expect(result.body).toMatch(/approval/);
  });

  it('orients rather than inventing an answer when no specialist owns the question', () => {
    const result = answer('zzzz qqqq wibble', [companySlice], ['company']);
    expect(result.summary).toMatch(/No clear specialist owner/);
    expect(result.body).toMatch(/do not have a specialist/);
  });

  it('attributes every answer to the specialists that produced it', () => {
    for (const prompt of [
      'How is cash flow looking?',
      'What should I do today?',
      'How is the sales pipeline?',
    ]) {
      const result = answer(prompt, [companySlice, personalSlice], ['company', 'personal']);
      expect(result.outputs.size).toBeGreaterThan(0);
    }
  });

  it('cites the records it used', () => {
    const result = answer('What should I do today?', [companySlice, personalSlice], [
      'company',
      'personal',
    ]);
    expect(result.references.length).toBeGreaterThan(0);
    for (const reference of result.references) {
      expect(reference.scopeKey).toBeTruthy();
      expect(reference.label).toBeTruthy();
    }
  });

  it('only ever cites records from scopes it was given', () => {
    const result = answer('What should I do today?', [companySlice], ['company']);
    for (const reference of result.references) {
      expect(reference.scopeKey).toBe(companySlice.scopeKey);
    }
  });

  it('never leaks a personal record into a company-scoped answer', () => {
    const result = answer('What should I do today?', [companySlice], ['company']);
    const personalTitles = personal.data.tasks.map((t) => t.title);
    for (const title of personalTitles) {
      expect(result.body).not.toContain(title);
    }
  });

  it('separates sections with a blank line so headings do not merge into prose', () => {
    for (const prompt of ['What should I do today?', 'How has my recovery been?']) {
      const result = answer(prompt, [companySlice, personalSlice], ['company', 'personal']);
      // A section heading must start its own paragraph, never continue the line
      // above it — `.filter(Boolean)` used to drop the intentional blank.
      expect(result.body).toMatch(/\n\n\S/);
      for (const line of result.body.split('\n')) {
        expect(line.startsWith(' ')).toBe(false);
      }
    }
  });

  it('handles a completely empty space without throwing', () => {
    const bare: SpaceSlice = {
      scopeKey: 'company:empty',
      label: 'Empty Co',
      spaceKind: 'company',
      data: { ...companySlice.data, tasks: [], finance: [], contacts: [], automations: [], risks: [] },
    };
    for (const prompt of ['What should I do today?', 'How is cash flow?', 'How is the pipeline?']) {
      expect(() => answer(prompt, [bare], ['company'])).not.toThrow();
    }
  });
});
