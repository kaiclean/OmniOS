import { describe, expect, it } from 'vitest';

import { detectActLocally, toolJsonSchema } from '@/lib/ai/act';
import { TOOLS } from '@/lib/ai/tools';
import { personalScope, requiresApproval } from '@/lib/domain';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const scope = personalScope();

describe('deriving function-calling schemas from the registry', () => {
  it('produces a valid schema for every tool, with required fields honest', () => {
    for (const tool of TOOLS) {
      const schema = toolJsonSchema(tool);
      expect(schema.name).toBe(tool.id);
      expect(schema.description.length).toBeGreaterThan(10);
      const properties = schema.parameters['properties'] as Record<string, unknown>;
      expect(Object.keys(properties)).toEqual(tool.params.map((p) => p.name));
      // A param with a default is not "required" — the executor fills it. Telling
      // the model otherwise makes it invent values for things it need not say.
      const required = (schema.parameters['required'] as string[] | undefined) ?? [];
      for (const name of required) {
        const param = tool.params.find((p) => p.name === name)!;
        expect(param.required).toBe(true);
        expect(param.default).toBeUndefined();
      }
    }
  });
});

describe('the local acting path', () => {
  it('turns a plain command into the right call with the stated arguments', () => {
    const decision = detectActLocally('create a task called "Buy a whiteboard" due tomorrow, priority p1', scope, NOW);
    expect(decision.mode).toBe('act');
    const call = decision.calls[0]!;
    expect(call.toolId).toBe('create_task');
    expect(call.args['title']).toBe('Buy a whiteboard');
    expect(call.args['dueDate']).toBe('2026-08-08');
    expect(call.args['priority']).toBe('p1');
  });

  it('never acts on a question', () => {
    expect(detectActLocally('what should I do today?', scope, NOW).mode).toBe('answer');
    expect(detectActLocally('how is cash flow looking?', scope, NOW).mode).toBe('answer');
  });

  it('says plainly when a command cannot be parsed, instead of guessing', () => {
    const decision = detectActLocally('make everything better somehow', scope, NOW);
    expect(decision.mode).toBe('answer');
    expect(decision.calls).toHaveLength(0);
    expect(decision.note).toBeTruthy();
  });

  it('refuses to plan a call whose required arguments the founder never said', () => {
    const decision = detectActLocally('create a task', scope, NOW);
    expect(decision.calls).toHaveLength(0);
    expect(decision.note).toMatch(/title/);
  });

  it('can only ever plan; a gated tier still needs the gate', () => {
    // Whatever the planner produces, the tiers it can reach through proposeCore
    // keep their gating — pinned here against the tool set so a future tool
    // cannot arrive external-but-ungated.
    for (const tool of TOOLS) {
      if (tool.risk === 'external' || tool.risk === 'destructive') {
        expect(requiresApproval(tool.risk)).toBe(true);
      }
    }
  });
});
