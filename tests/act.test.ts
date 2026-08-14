import { describe, expect, it } from 'vitest';

import { detectAct, detectActLocally, toolCatalogue, toolJsonSchema } from '@/lib/ai/act';
import { TOOLS } from '@/lib/ai/tools';
import type { LlmProvider, LlmRequest, LlmToolResponse, ToolDefinition } from '@/lib/domain';
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
    // The missing piece is named in the founder's language, from the param's
    // own description — never as a bare parameter name.
    expect(decision.note).toMatch(/what needs doing/i);
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

describe('commands are spoken singular; collections are stored plural', () => {
  it('resolves "the task" to the tasks collection and flags a command', () => {
    const decision = detectActLocally('delete the task "Ship the deck"', scope, NOW);
    expect(decision.mode).toBe('act');
    expect(decision.intent).toBe('command');
    const call = decision.calls[0]!;
    expect(call.toolId).toBe('delete_record');
    expect(call.args['collection']).toBe('tasks');
    expect(call.args['recordId']).toBe('Ship the deck');
  });

  it('never lets a collection word hiding inside the quoted title pick the collection', () => {
    const decision = detectActLocally('delete that "goal notes"', scope, NOW);
    expect(decision.mode).toBe('answer');
    expect(decision.note).toMatch(/which collection/i);
  });

  it('recognises reset as an imperative and extracts the capability', () => {
    const decision = detectActLocally('reset the marketing capability data', scope, NOW);
    expect(decision.mode).toBe('act');
    expect(decision.intent).toBe('command');
    const call = decision.calls[0]!;
    expect(call.toolId).toBe('reset_capability_data');
    expect(call.args['capabilityId']).toBe('marketing');
  });

  it('names what is missing in founder language, never raw parameter names', () => {
    const decision = detectActLocally('delete that "Old scribble"', scope, NOW);
    expect(decision.mode).toBe('answer');
    expect(decision.intent).toBe('command');
    // "collection" alone is our word; the founder gets the description.
    expect(decision.note).toMatch(/which collection the record is in/i);
    expect(decision.note).not.toMatch(/\bneed collection\b/);
  });
});

describe('the model planner sees this conversation, not one orphaned sentence', () => {
  function capturing() {
    const requests: LlmRequest[] = [];
    const provider: LlmProvider = {
      id: 'capturing',
      label: 'Capturing',
      simulated: false,
      keyName: null,
      available: async () => true,
      complete: async () => ({ text: '', providerId: 'capturing', simulated: false }),
      completeWithTools: async (request): Promise<LlmToolResponse> => {
        requests.push(request);
        return { text: '', calls: [] };
      },
    };
    return { provider, requests };
  }

  it('threads history between the system prompt and the current sentence', async () => {
    const { provider, requests } = capturing();
    await detectAct('the first one', {
      scope,
      provider,
      now: NOW,
      history: [
        { role: 'user', content: 'Create a company you will run.' },
        { role: 'assistant', content: 'Fixed-price or retainer?' },
      ],
    });

    const messages = requests[0]!.messages;
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Create a company you will run.' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Fixed-price or retainer?' });
    // The founder's answer stays last, so the planner reads it as the reply to
    // what came before rather than as a self-contained order.
    expect(messages[3]!.content).toContain('the first one');
  });

  it('tells the planner that delegated choices are its to make, and facts are not', async () => {
    const { provider, requests } = capturing();
    await detectAct('set it up', { scope, provider, now: NOW });

    const system = requests[0]!.messages[0]!.content;
    expect(system).toMatch(/Choices the founder handed to you are yours to make/);
    expect(system).toMatch(/Facts are never yours to invent/);
    // The old rule this replaced — refusing outright on any uncertain write —
    // must not creep back in and turn every delegation into a questionnaire.
    expect(system).not.toMatch(/plan nothing and say so/);
  });
});
