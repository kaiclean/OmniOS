import { describe, expect, it } from 'vitest';

import { detectActLocally, toolCatalogue, toolJsonSchema } from '@/lib/ai/act';
import { TOOLS } from '@/lib/ai/tools';
import type { ToolDefinition } from '@/lib/domain';
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

describe('the catalogue offers provider-legal names and resolves them back', () => {
  /**
   * Both provider tool APIs constrain a function name to ^[a-zA-Z0-9_-]{1,64}$,
   * and a bridged connection tool's id is `mcp:<server>:<tool>` — colons and
   * all. Every remote tool was once offered under a name the wire format
   * forbids, so the model could not call any of them: fourteen filesystem tools
   * sat connected, tiered and unreachable. The fix went in untested; this is
   * the test.
   */
  const remote = (id: string): ToolDefinition => ({
    id,
    label: id,
    description: 'A bridged connection tool, for the name round-trip.',
    risk: 'external',
    capabilityId: 'operations',
    scopeKinds: ['company', 'personal'],
    matches: [],
    params: [],
    preview: () => 'preview',
  });

  it('every offered name is legal for the wire, built-in and bridged alike', () => {
    const catalogue = toolCatalogue([...TOOLS, remote('mcp:filesystem:read_file')]);
    for (const schema of catalogue.schemas) {
      expect(schema.name, schema.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it('resolves a sanitised name back to the exact tool id', () => {
    const catalogue = toolCatalogue([remote('mcp:filesystem:read_file')]);
    const name = catalogue.schemas[0]!.name;
    expect(name).toBe('mcp_filesystem_read_file');
    expect(catalogue.byName.get(name)).toBe('mcp:filesystem:read_file');
  });

  it('disambiguates two ids that sanitise identically, deterministically', () => {
    // `mcp:a:b` and `mcp:a_b` both sanitise to `mcp_a_b`. Letting the later one
    // shadow the earlier would silently route a call to the wrong tool — the
    // worst failure available here.
    const catalogue = toolCatalogue([remote('mcp:srv:do_thing'), remote('mcp:srv_do:thing')]);
    const names = catalogue.schemas.map((schema) => schema.name);
    expect(new Set(names).size).toBe(2);
    expect(catalogue.byName.get(names[0]!)).toBe('mcp:srv:do_thing');
    expect(catalogue.byName.get(names[1]!)).toBe('mcp:srv_do:thing');
    // Deterministic: the same input yields the same names on every call.
    expect(toolCatalogue([remote('mcp:srv:do_thing'), remote('mcp:srv_do:thing')]).schemas.map((s) => s.name)).toEqual(names);
  });

  it('never maps a name it did not mint', () => {
    // detectAct drops any model call whose name is absent from the reverse map,
    // rather than guessing — pin the map is exact.
    const catalogue = toolCatalogue([...TOOLS]);
    expect(catalogue.byName.get('mcp_filesystem_read_file')).toBeUndefined();
    expect(catalogue.byName.size).toBe(catalogue.schemas.length);
  });
});
