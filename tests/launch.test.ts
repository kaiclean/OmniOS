import { describe, expect, it } from 'vitest';

import {
  BUSINESS_MODELS,
  buildLaunchProgram,
  inferBusinessModel,
  type BusinessModel,
  type LaunchProgramInput,
} from '@/lib/business/playbook';
import { getTool } from '@/lib/ai/tools';
import { requiresApproval, validateArgs } from '@/lib/domain';

function input(patch: Partial<LaunchProgramInput> = {}): LaunchProgramInput {
  return {
    companyName: 'Meridian Supply',
    companyId: 'meridian-supply',
    model: 'dropshipping',
    oneLiner: 'Hard-wearing kit for people who work outdoors.',
    currency: 'CHF',
    testBudgetMinor: 200_000,
    startDate: '2026-08-07',
    ...patch,
  };
}

describe('the launch programme', () => {
  it('produces the same plan twice, for every model', () => {
    for (const model of BUSINESS_MODELS) {
      const first = buildLaunchProgram(input({ model }));
      const second = buildLaunchProgram(input({ model }));
      expect(second).toEqual(first);
    }
  });

  it('gives every model a plan with both halves of the work', () => {
    for (const model of BUSINESS_MODELS) {
      const steps = buildLaunchProgram(input({ model }));
      const internal = steps.filter((step) => step.kind === 'internal');
      const outward = steps.filter((step) => step.kind === 'outward');

      expect(internal.length).toBeGreaterThan(5);
      expect(outward.length).toBeGreaterThan(0);
      // Ids are used as React keys and as step identifiers in the report.
      expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
    }
  });

  /**
   * The test that earns its keep: a plan referencing a tool that does not exist,
   * or handing it arguments it would reject, is a plan that fails silently at
   * run time and fills the founder's workspace with nothing.
   */
  it('only ever names real tools, with arguments those tools accept', () => {
    for (const model of BUSINESS_MODELS) {
      for (const step of buildLaunchProgram(input({ model }))) {
        if (step.kind !== 'internal') continue;

        const tool = getTool(step.toolId ?? '');
        expect(tool, `${model}/${step.id} names ${step.toolId}`).toBeDefined();

        const validation = validateArgs(tool!, step.args ?? {});
        expect(validation.errors, `${model}/${step.id}`).toEqual([]);
        expect(tool!.scopeKinds).toContain('company');
      }
    }
  });

  it('never lets an internal step be one that would leave the machine', () => {
    for (const model of BUSINESS_MODELS) {
      for (const step of buildLaunchProgram(input({ model }))) {
        if (step.kind !== 'internal') continue;
        const tool = getTool(step.toolId ?? '');
        // An internal step runs unattended, so it must be a tier that may.
        expect(requiresApproval(tool!.risk), `${model}/${step.id}`).toBe(false);
      }
    }
  });

  it('describes every outward step well enough to match a connection to it', () => {
    for (const model of BUSINESS_MODELS) {
      for (const step of buildLaunchProgram(input({ model }))) {
        if (step.kind !== 'outward') continue;
        expect(step.toolId, `${model}/${step.id} must not hard-wire a tool`).toBeUndefined();
        expect(step.need?.toolNameHints.length ?? 0).toBeGreaterThan(0);
        expect(step.need?.intent.length ?? 0).toBeGreaterThan(20);
      }
    }
  });

  it('carries the founder’s own numbers into the plan rather than inventing them', () => {
    const steps = buildLaunchProgram(input({ testBudgetMinor: 750_000, currency: 'EUR' }));
    const budget = steps.find((step) => step.id === 'budget');

    expect(budget?.args?.['amountMinor']).toBe(750_000);
    expect(budget?.args?.['currency']).toBe('EUR');
    // Booked as a forecast: the money has been decided, not spent.
    expect(budget?.args?.['confidence']).toBe('forecast');

    const economics = steps.find((step) => step.id === 'unit-economics');
    expect(String(economics?.args?.['body'])).toContain('EUR 7500.00');
  });

  it('leaves price blank rather than estimating it', () => {
    const steps = buildLaunchProgram(input());
    const positioning = String(steps.find((step) => step.id === 'positioning')?.args?.['body'] ?? '');

    expect(positioning).toMatch(/Left blank on purpose/i);
    // And the decision it blocks exists as real, top-priority work.
    const task = steps.find((step) => step.id === 'task-decide-offer');
    expect(task?.args?.['priority']).toBe('p0');
  });

  it('dates the goal ninety days out from the day it was run', () => {
    const steps = buildLaunchProgram(input({ startDate: '2026-12-15' }));
    expect(steps.find((step) => step.id === 'goal')?.args?.['targetDate']).toBe('2027-03-15');
  });
});

describe('guessing the shape of a business', () => {
  it('reads the founder’s own description', () => {
    const cases: Array<[string, BusinessModel]> = [
      ['dropshipping store selling outdoor kit', 'dropshipping'],
      ['direct to consumer ecommerce', 'dropshipping'],
      ['B2B SaaS platform', 'saas'],
      ['design studio on retainer', 'agency'],
      ['newsletter and audience business', 'content'],
      ['local repair services', 'local-service'],
    ];
    for (const [text, expected] of cases) {
      expect(inferBusinessModel(text), text).toBe(expected);
    }
  });

  it('falls back rather than guessing wildly on an empty description', () => {
    expect(BUSINESS_MODELS).toContain(inferBusinessModel(''));
    expect(BUSINESS_MODELS).toContain(inferBusinessModel('something entirely new'));
  });
});
