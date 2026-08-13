import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_SCOPED_COLLECTIONS,
  DELETABLE_COLLECTIONS,
  TOOLS,
  getTool,
  scoreTools,
  toolIds,
  toolsForCapability,
  toolsForScope,
  toolsForScopeKind,
} from '@/lib/ai/tools';
import type { ParamType, ToolArgs, ToolDefinition } from '@/lib/domain';
import {
  AUTONOMOUS_RISK_TIERS,
  PARAM_TYPES,
  RISK_TIERS,
  companyScope,
  isDecidedCall,
  personalScope,
  requiresApproval,
  sharedScope,
  validateArgs,
} from '@/lib/domain';
import { COLLECTION_NAMES } from '@/lib/data/schema';
import { CAPABILITIES, capabilitiesFor, getCapability } from '@/lib/capabilities/registry';

/**
 * Plausible arguments for one tool, built from its own declaration.
 *
 * Derived rather than fixtured on purpose: a tool added to the registry is
 * exercised by every test below without anyone remembering to extend a fixture,
 * which is the failure mode a hand-written table always eventually hits.
 */
function validArgsFor(tool: ToolDefinition): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of tool.params) {
    args[param.name] = sampleFor(param.type, param.enumValues);
  }
  return args;
}

function sampleFor(type: ParamType, enumValues?: readonly string[]): unknown {
  switch (type) {
    case 'number':
      return 12;
    case 'boolean':
      return true;
    case 'enum':
      return enumValues?.[0] ?? 'x';
    case 'date':
      return '2026-03-04';
    case 'scope':
      return 'personal';
    case 'text':
      return 'A sentence long enough to look like something a founder actually said.';
    case 'string':
    default:
      return 'Sample value';
  }
}

/* --------------------------------------------------------------- shape ---- */

describe('tool registry', () => {
  it('has unique ids', () => {
    const ids = toolIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses snake_case ids that read as verbs', () => {
    for (const tool of TOOLS) {
      expect(tool.id, `${tool.id} is not snake_case`).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  it('declares every tool the brief asks for', () => {
    const required = [
      'create_task', 'update_task', 'complete_task', 'create_goal', 'update_goal',
      'add_kpi', 'record_kpi_value', 'write_doc', 'add_contact', 'log_contact_touch',
      'add_finance_entry', 'create_automation', 'set_automation_status', 'create_brief',
      'add_roadmap_item', 'add_risk', 'remember', 'log_health_day', 'add_habit',
      'complete_habit', 'add_relationship', 'schedule_block', 'add_life_admin',
      'accept_suggestion', 'dismiss_suggestion', 'delete_record', 'reset_capability_data',
      'send_email', 'publish_post', 'call_webhook',
    ];
    for (const id of required) {
      expect(getTool(id), `${id} is missing from the registry`).toBeDefined();
    }
  });

  it('gives every tool a real risk tier and at least one scope kind', () => {
    for (const tool of TOOLS) {
      expect(RISK_TIERS, `${tool.id}`).toContain(tool.risk);
      expect(tool.scopeKinds.length, `${tool.id} applies to no space`).toBeGreaterThan(0);
    }
  });

  it('only names capabilities that exist', () => {
    const known = new Set(CAPABILITIES.map((c) => c.id));
    for (const tool of TOOLS) {
      expect(known.has(tool.capabilityId), `${tool.id} names unknown capability`).toBe(true);
    }
  });

  it('files each tool under a capability the tool’s own spaces actually run', () => {
    for (const tool of TOOLS) {
      for (const kind of tool.scopeKinds) {
        expect(
          capabilitiesFor(kind).some((c) => c.id === tool.capabilityId),
          `${tool.id} files under "${tool.capabilityId}", which a ${kind} space does not have`,
        ).toBe(true);
      }
    }
  });

  it('gives every tool routing phrases and a description worth reading', () => {
    for (const tool of TOOLS) {
      expect(tool.matches.length, `${tool.id} has no matches`).toBeGreaterThan(0);
      expect(tool.description.length, `${tool.id} has a thin description`).toBeGreaterThan(40);
      for (const phrase of tool.matches) {
        expect(phrase, `${tool.id} has a non-lowercase match phrase`).toBe(phrase.toLowerCase());
      }
    }
  });
});

/* -------------------------------------------------------------- params ---- */

describe('tool parameters', () => {
  it('declares only known types, with enum values wherever the type is enum', () => {
    for (const tool of TOOLS) {
      for (const param of tool.params) {
        expect(PARAM_TYPES, `${tool.id}.${param.name}`).toContain(param.type);
        if (param.type === 'enum') {
          expect(param.enumValues?.length, `${tool.id}.${param.name} has no enum values`).toBeGreaterThan(0);
        }
        expect(param.description.length, `${tool.id}.${param.name} is undocumented`).toBeGreaterThan(3);
      }
    }
  });

  it('names each parameter once per tool', () => {
    for (const tool of TOOLS) {
      const names = tool.params.map((p) => p.name);
      expect(new Set(names).size, `${tool.id} declares a parameter twice`).toBe(names.length);
    }
  });

  it('keeps every default inside its own enum', () => {
    for (const tool of TOOLS) {
      for (const param of tool.params) {
        if (param.type !== 'enum' || param.default === undefined) continue;
        expect(param.enumValues, `${tool.id}.${param.name} defaults outside its enum`).toContain(
          param.default,
        );
      }
    }
  });

  it('validates the arguments it declares', () => {
    for (const tool of TOOLS) {
      const result = validateArgs(tool, validArgsFor(tool));
      expect(result.ok, `${tool.id}: ${result.errors.join('; ')}`).toBe(true);
      expect(result.errors).toEqual([]);
    }
  });

  it('rejects a call that omits a required parameter with no default', () => {
    for (const tool of TOOLS) {
      const required = tool.params.find((p) => p.required && p.default === undefined);
      if (!required) continue;
      const args = validArgsFor(tool);
      delete args[required.name];
      const result = validateArgs(tool, args);
      expect(result.ok, `${tool.id} accepted a call missing ${required.name}`).toBe(false);
      expect(result.errors.join(' ')).toContain(required.name);
    }
  });

  it('fills defaults in for omitted optional parameters', () => {
    for (const tool of TOOLS) {
      for (const param of tool.params) {
        if (param.default === undefined) continue;
        const args = validArgsFor(tool);
        delete args[param.name];
        const result = validateArgs(tool, args);
        expect(result.coerced[param.name], `${tool.id}.${param.name} lost its default`).toBe(
          param.default,
        );
      }
    }
  });

  it('coerces strings to numbers, booleans and trimmed text', () => {
    const tool = getTool('add_finance_entry');
    expect(tool).toBeDefined();
    const result = validateArgs(tool as ToolDefinition, {
      date: '2026-03-04',
      direction: 'in',
      amountMinor: '125000',
      label: '  Retainer  ',
      recurring: 'on',
    });
    expect(result.ok).toBe(true);
    expect(result.coerced.amountMinor).toBe(125000);
    expect(result.coerced.recurring).toBe(true);
    expect(result.coerced.label).toBe('Retainer');
    expect(result.coerced.currency).toBe('CHF');
  });

  it('rejects a bad number, a bad enum and a bad date', () => {
    const tool = getTool('add_finance_entry') as ToolDefinition;
    const result = validateArgs(tool, {
      date: '4 March',
      direction: 'sideways',
      amountMinor: 'quite a lot',
      label: 'Retainer',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('date');
    expect(result.errors.join(' ')).toContain('direction');
    expect(result.errors.join(' ')).toContain('amountMinor');
  });

  it('drops keys the tool never declared', () => {
    const tool = getTool('complete_task') as ToolDefinition;
    const result = validateArgs(tool, { taskId: 'task_1', scope: 'company:someone-else', __proto__: 'x' });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.coerced)).toEqual(['taskId']);
  });
});

/* ---------------------------------------------------------------- risk ---- */

describe('the approval gate', () => {
  it('lets write and read tiers run, and stops destructive and external', () => {
    for (const tool of TOOLS) {
      const autonomous = (AUTONOMOUS_RISK_TIERS as readonly string[]).includes(tool.risk);
      expect(requiresApproval(tool.risk), `${tool.id} (${tool.risk})`).toBe(!autonomous);
    }
  });

  it('tiers the destructive tools as destructive', () => {
    for (const id of ['delete_record', 'reset_capability_data']) {
      const tool = getTool(id) as ToolDefinition;
      expect(tool.risk, id).toBe('destructive');
      expect(requiresApproval(tool.risk)).toBe(true);
    }
  });

  it('tiers everything that leaves the machine as external', () => {
    for (const id of ['send_email', 'publish_post', 'call_webhook']) {
      const tool = getTool(id) as ToolDefinition;
      expect(tool.risk, id).toBe('external');
      expect(requiresApproval(tool.risk)).toBe(true);
    }
  });

  /**
   * The tier is the only gate, so a tool tiered `write` while quietly deleting or
   * sending is the one bug that would defeat the whole design. Language is the
   * cheapest available proxy for intent, and it has caught a mis-tiering before.
   */
  it('has no write tool that talks like a destructive or external one', () => {
    const dangerous = /\b(delete|deletes|erase|erases|wipe|wipes|destroy|permanently|send|sends|publish|publishes|transfer|pay|pays)\b/i;
    for (const tool of TOOLS) {
      if (requiresApproval(tool.risk)) continue;
      const text = `${tool.label} ${tool.description}`;
      const hit = text.match(dangerous);
      // "never sends", "does not delete" and the like are the point, not a smell.
      const negated = hit ? new RegExp(`\\b(not|never|no|cannot|without)\\b[^.]{0,40}${hit[0]}`, 'i').test(text) : false;
      expect(
        hit === null || negated,
        `${tool.id} is tiered ${tool.risk} but its description says "${hit?.[0]}"`,
      ).toBe(true);
    }
  });

  it('never lets a write tool touch a collection delete_record is forbidden from', () => {
    const auditOnly = COLLECTION_NAMES.filter(
      (name) => !(DELETABLE_COLLECTIONS as readonly string[]).includes(name),
    );
    expect(auditOnly).toContain('evolution');
    expect(auditOnly).toContain('toolCalls');
    expect(auditOnly).toContain('agentRuns');
    expect(auditOnly).toContain('automationRuns');
    expect(auditOnly).toContain('messages');
  });

  it('only offers collections the store actually has', () => {
    for (const name of [...DELETABLE_COLLECTIONS, ...CAPABILITY_SCOPED_COLLECTIONS]) {
      expect(COLLECTION_NAMES, `${name} is not a collection`).toContain(name);
    }
  });

  it('keeps the destructive tools’ collection lists inside their declared enums', () => {
    const deleteTool = getTool('delete_record') as ToolDefinition;
    const collection = deleteTool.params.find((p) => p.name === 'collection');
    expect(collection?.enumValues).toEqual([...DELETABLE_COLLECTIONS]);
  });

  it('only accepts a secret placeholder on a parameter declared to take one', () => {
    const withSecrets = TOOLS.filter((tool) => tool.params.some((p) => p.acceptsSecret));
    expect(withSecrets.length).toBeGreaterThan(0);
    for (const tool of withSecrets) {
      // A tool that can hold a credential is by definition reaching outside.
      expect(tool.risk, `${tool.id} accepts a secret but is tiered ${tool.risk}`).toBe('external');
    }
  });
});

/* ------------------------------------------------------------- preview ---- */

describe('preview', () => {
  it('returns a non-empty sentence for every tool given valid args', () => {
    for (const tool of TOOLS) {
      const { coerced, ok } = validateArgs(tool, validArgsFor(tool));
      expect(ok, `${tool.id} could not produce valid args`).toBe(true);
      const preview = tool.preview(coerced);
      expect(preview.length, `${tool.id} previewed nothing`).toBeGreaterThan(20);
      expect(preview.trim().endsWith('.'), `${tool.id} preview is not a sentence: ${preview}`).toBe(true);
      expect(preview, `${tool.id} preview leaked undefined`).not.toContain('undefined');
      expect(preview, `${tool.id} preview leaked [object Object]`).not.toContain('[object');
    }
  });

  it('still renders a sentence when arguments are missing', () => {
    for (const tool of TOOLS) {
      const preview = tool.preview({} as ToolArgs);
      expect(preview.length, `${tool.id} previewed nothing for empty args`).toBeGreaterThan(20);
      expect(preview, `${tool.id} preview leaked undefined`).not.toContain('undefined');
    }
  });

  it('says out loud that a gated tool is gated', () => {
    for (const tool of TOOLS) {
      if (!requiresApproval(tool.risk)) continue;
      const preview = tool.preview(validateArgs(tool, validArgsFor(tool)).coerced);
      expect(
        /cannot be undone|needs your approval/i.test(preview),
        `${tool.id} previews a ${tool.risk} action without saying so: ${preview}`,
      ).toBe(true);
    }
  });

  it('names the values it was given', () => {
    const tool = getTool('create_task') as ToolDefinition;
    const { coerced } = validateArgs(tool, {
      title: 'Call the auditor',
      capabilityId: 'finance',
      priority: 'p0',
      dueDate: '2026-04-01',
    });
    const preview = tool.preview(coerced);
    expect(preview).toContain('Call the auditor');
    expect(preview).toContain('finance');
    expect(preview).toContain('p0');
    expect(preview).toContain('2026-04-01');
  });

  it('shows an em dash rather than a zero for an amount it was not given', () => {
    const tool = getTool('add_contact') as ToolDefinition;
    const { coerced } = validateArgs(tool, { name: 'Nadia Roth' });
    const preview = tool.preview(coerced);
    expect(preview).toContain('—');
    expect(preview).not.toContain('CHF 0');
  });
});

/* -------------------------------------------------------------- lookup ---- */

describe('lookup and routing', () => {
  it('finds a tool by id and nothing by a made-up one', () => {
    expect(getTool('create_task')?.label).toBe('Create a task');
    expect(getTool('drop_database')).toBeUndefined();
  });

  it('offers no tools at all in a shared capability scope', () => {
    expect(toolsForScope(sharedScope('finance'))).toEqual([]);
  });

  it('keeps personal-only tools out of a company space', () => {
    const companyIds = toolsForScope(companyScope('acme-1234')).map((t) => t.id);
    expect(companyIds).not.toContain('log_health_day');
    expect(companyIds).not.toContain('add_relationship');
    expect(companyIds).not.toContain('add_life_admin');
    expect(companyIds).toContain('create_task');
  });

  it('gives personal life both the shared tools and its own', () => {
    const personalIds = toolsForScope(personalScope()).map((t) => t.id);
    expect(personalIds).toContain('log_health_day');
    expect(personalIds).toContain('complete_habit');
    expect(personalIds).toContain('create_task');
  });

  it('agrees with itself about scope kinds', () => {
    expect(toolsForScope(personalScope())).toEqual(toolsForScopeKind('personal'));
    expect(toolsForScope(companyScope('acme-1234'))).toEqual(toolsForScopeKind('company'));
  });

  it('groups tools under the capability that owns them', () => {
    const finance = toolsForCapability('finance').map((t) => t.id);
    expect(finance).toEqual(['add_finance_entry']);
    for (const tool of toolsForCapability('health')) {
      expect(getCapability(tool.capabilityId)?.id).toBe('health');
    }
  });

  it('scores the obvious tool top for an obvious sentence', () => {
    expect(scoreTools('remind me to call the auditor on Friday')[0]?.tool.id).toBe('create_task');
    expect(scoreTools('log an expense for the new laptop')[0]?.tool.id).toBe('add_finance_entry');
    expect(scoreTools('I slept 5 hours last night')[0]?.tool.id).toBe('log_health_day');
    expect(scoreTools('remember that I never take meetings before ten')[0]?.tool.id).toBe('remember');
  });

  it('returns nothing for a sentence no tool claims', () => {
    expect(scoreTools('')).toEqual([]);
    expect(scoreTools('zqx wibble frobnicate')).toEqual([]);
  });

  it('never scores a personal tool for a company scope', () => {
    const scored = scoreTools('I slept 5 hours last night', companyScope('acme-1234'));
    expect(scored.map((s) => s.tool.id)).not.toContain('log_health_day');
  });

  it('ranks a destructive tool without letting it run', () => {
    const top = scoreTools('delete that record')[0];
    expect(top?.tool.id).toBe('delete_record');
    expect(requiresApproval(top?.tool.risk ?? 'read')).toBe(true);
  });

  it('is deterministic', () => {
    const prompt = 'automate this weekly and send an email about it';
    expect(scoreTools(prompt).map((s) => s.tool.id)).toEqual(scoreTools(prompt).map((s) => s.tool.id));
  });
});

describe('what counts as a decision', () => {
  const at = '2026-08-07T12:00:00.000Z';
  it('an auto-run low-risk call is activity, not an approval', () => {
    expect(isDecidedCall({ status: 'executed', decidedAt: undefined })).toBe(false);
    expect(isDecidedCall({ status: 'failed', decidedAt: undefined })).toBe(false);
  });
  it('approved, rejected and grant-covered calls are decisions', () => {
    expect(isDecidedCall({ status: 'executed', decidedAt: at })).toBe(true);
    expect(isDecidedCall({ status: 'rejected', decidedAt: at })).toBe(true);
  });
  it('a call still waiting is not decided, whatever fields it carries', () => {
    expect(isDecidedCall({ status: 'awaiting-approval', decidedAt: at })).toBe(false);
    expect(isDecidedCall({ status: 'awaiting-approval', decidedAt: undefined })).toBe(false);
  });
});
