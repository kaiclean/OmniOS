import 'server-only';

/**
 * Tool execution — the facade, and the one place the approval gate is consulted.
 *
 * `runTool` below is the single entry point. It resolves the tool, checks scope
 * and arguments, refuses a secret placeholder in a parameter that does not take
 * one, and asks `requiresApproval(tool.risk, policy)` before any executor runs.
 * The executors themselves live in `./executors/`, grouped by what they touch,
 * and none of them is exported for application code to call: the table here is
 * the only thing that reaches them, so the gate cannot be bypassed by importing
 * one directly. Keep it that way — a second call site would be a second gate.
 *
 * Three properties hold across every executor:
 *
 * 1. **Everything goes through `lib/data/store.ts`.** No executor touches the
 *    filesystem, and every read and write names a scope, so a crafted id cannot
 *    reach a record in another space — it is simply not in the collection that
 *    was read.
 * 2. **The tier is the gate, and the gate lives in `runTool`.** Executors are
 *    never called directly by application code; `runTool` asks
 *    `requiresApproval(tool.risk)` first and refuses without a recorded
 *    decision. Putting the check anywhere else — a component, a Server Action,
 *    a prompt — would make it something a caller could forget.
 * 3. **Secret plaintext never leaves an executor.** Only `ctx.resolveSecrets`
 *    can produce it, the resolved string is used and dropped, and the outcome is
 *    run through `redact` on the way out. The persisted `ToolCall` keeps the
 *    `{{secret:NAME}}` placeholder, never the value.
 *
 * The three `external` tools are declared and refuse (`./executors/gated.ts`).
 * That is deliberate: an executor that pretended to send an email would be a lie
 * in the one place a founder most needs the system to be literal, and declaring
 * them is what proves the approval gate works end to end.
 *
 * Why split: this file was one 1,281-line module mixing the gate with thirty
 * executors. Splitting by group keeps each reviewable on its own and leaves the
 * gate small enough to read in one sitting. Importers are unchanged.
 */

import {
  parseMcpToolId,
  redact,
  referencedSecretNames,
  requiresApproval,
  validateArgs,
  type ApprovalPolicy,
  type Timestamp,
  type ToolArgs,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutor,
  type ToolOutcome,
} from '@/lib/domain';
import { getWorkspace } from '@/lib/data/store';
import { callMcpTool } from '@/lib/mcp/client';
import { mcpToolDefinition } from './mcp-bridge';
import { allSecretValues } from '@/lib/secrets/vault';
import { getTool, type ToolId } from './index';
import {
  createTask,
  updateTask,
  completeTask,
  createGoal,
  updateGoal,
  addKpi,
  recordKpiValue,
  writeDoc,
  addRoadmapItem,
  addRisk,
  addContact,
  logContactTouch,
  addFinanceEntry,
  createAutomation,
  setAutomationStatus,
  createBrief,
  remember,
} from './executors/company';
import {
  logHealthDay,
  addHabit,
  completeHabit,
  addRelationship,
  scheduleBlock,
  addLifeAdmin,
  decideSuggestion,
} from './executors/personal';
import { deleteRecord, resetCapabilityData, notWired } from './executors/gated';
import { searchWorkspace, getRecord } from './executors/read';
import { createCompanyTool, hireAgentTool, openMeetingTool } from './executors/founder';
import { ok, refuse, spaceKindOf } from './executors/shared';

/** Re-exported so the assistant can be told not to offer them; defined beside the executors that refuse. */
export { NOT_WIRED_TOOL_IDS } from './executors/gated';

/* ------------------------------------------------------------ the table --- */

/**
 * Typed as `Record<ToolId, ToolExecutor>`, so a tool added to the registry
 * without an executor is a compile error rather than a runtime surprise on the
 * day a founder first reaches for it.
 */
const EXECUTORS: Record<ToolId, ToolExecutor> = {
  create_company: createCompanyTool,
  hire_agent: hireAgentTool,
  open_meeting: openMeetingTool,
  search_workspace: searchWorkspace,
  get_record: getRecord,
  create_task: createTask,
  update_task: updateTask,
  complete_task: completeTask,
  create_goal: createGoal,
  update_goal: updateGoal,
  add_kpi: addKpi,
  record_kpi_value: recordKpiValue,
  write_doc: writeDoc,
  add_roadmap_item: addRoadmapItem,
  add_risk: addRisk,
  add_contact: addContact,
  log_contact_touch: logContactTouch,
  add_finance_entry: addFinanceEntry,
  create_automation: createAutomation,
  set_automation_status: setAutomationStatus,
  create_brief: createBrief,
  remember,
  log_health_day: logHealthDay,
  add_habit: addHabit,
  complete_habit: completeHabit,
  add_relationship: addRelationship,
  schedule_block: scheduleBlock,
  add_life_admin: addLifeAdmin,
  accept_suggestion: decideSuggestion('accepted'),
  dismiss_suggestion: decideSuggestion('dismissed'),
  delete_record: deleteRecord,
  reset_capability_data: resetCapabilityData,
  send_email: notWired('an email', 'email provider'),
  publish_post: notWired('a post', 'publishing channel'),
  call_webhook: notWired('a webhook call', 'outbound HTTP client'),
};

export function hasExecutor(toolId: string): boolean {
  return toolId in EXECUTORS || parseMcpToolId(toolId) !== null;
}

/* -------------------------------------------------------------- remote ---- */

/**
 * Resolve a tool id to a definition, including one that lives on a connection.
 *
 * Async because a remote tool's shape is not compiled in: it comes from the last
 * probe of the server that advertises it. Everything downstream — validation,
 * the smuggling check, the gate, the preview — then treats it exactly like a
 * built-in, which is the only reason adding MCP did not require a second gate.
 */
export async function resolveTool(toolId: string): Promise<ToolDefinition | undefined> {
  const local = getTool(toolId);
  if (local) return local;

  const parsed = parseMcpToolId(toolId);
  if (!parsed) return undefined;

  const workspace = await getWorkspace();
  const server = workspace.mcpServers.find((candidate) => candidate.id === parsed.serverId);
  if (!server || !server.enabled) return undefined;
  if (server.disabledTools.includes(parsed.toolName)) return undefined;

  const state = workspace.mcpStates.find((candidate) => candidate.serverId === parsed.serverId);
  const descriptor = state?.tools.find((candidate) => candidate.name === parsed.toolName);
  if (!descriptor) return undefined;

  return mcpToolDefinition(server, descriptor);
}

/**
 * Send a validated call to the server that advertised it.
 *
 * Placeholders are resolved here and nowhere earlier, so the `ToolCall` that was
 * already persisted carries `{{secret:NAME}}` while the transport carries the
 * value — which is invariant 6 in its most literal form.
 */
async function executeMcpTool(
  tool: ToolDefinition,
  ctx: ToolContext,
  args: ToolArgs,
): Promise<ToolOutcome> {
  const parsed = parseMcpToolId(tool.id);
  if (!parsed) return refuse(`${tool.label} is not a connection tool.`, 'Malformed remote tool id.');

  const workspace = await getWorkspace();
  const server = workspace.mcpServers.find((candidate) => candidate.id === parsed.serverId);
  if (!server) {
    return refuse(`${tool.label} has no connection.`, `No server called “${parsed.serverId}” is configured.`);
  }

  const payload: Record<string, unknown> = {};
  for (const param of tool.params) {
    const value = args[param.name];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const resolved = await ctx.resolveSecrets(value);
      // A `text` param is how a structured argument survives a flat form. If it
      // parses as JSON the server gets the structure it declared; if it does not,
      // it gets the string, because guessing would be worse than being literal.
      if (param.type === 'text') {
        try {
          payload[param.name] = JSON.parse(resolved) as unknown;
          continue;
        } catch {
          // Fall through to the string.
        }
      }
      payload[param.name] = resolved;
      continue;
    }
    payload[param.name] = value;
  }

  const result = await callMcpTool(server, parsed.toolName, payload);
  if (!result.ok) {
    return refuse(`${parsed.toolName} on ${server.name} failed.`, result.text || 'The server gave no reason.');
  }

  return ok(
    result.text
      ? `${parsed.toolName} on ${server.name} returned: ${result.text}`
      : `${parsed.toolName} on ${server.name} completed and returned nothing.`,
  );
}

/* ----------------------------------------------------------------- gate --- */

/** A decision a human actually made, recorded before a gated tool may run. */
export interface ToolApproval {
  readonly decidedBy: string;
  readonly decidedAt: Timestamp;
}

export interface RunToolOptions {
  /** Required for any tool where `requiresApproval(tool.risk)` is true. */
  readonly approval?: ToolApproval;
}

/**
 * The founder's own tightening of the gate, read from settings.
 *
 * Read here rather than passed in, so no caller can reach `runTool` with a
 * policy the founder never chose.
 */
async function approvalPolicy(): Promise<ApprovalPolicy> {
  const workspace = await getWorkspace();
  return { confirmWrites: workspace.settings.confirmWrites };
}

/**
 * Run a tool.
 *
 * The single entry point, and the only place the approval gate is consulted. It
 * checks, in order: the tool exists, the scope may run it, the arguments
 * validate, no secret placeholder is hiding in a parameter that has no business
 * carrying one, and — last — that a gated tier has a recorded human decision.
 */
export async function runTool(
  toolId: string,
  ctx: ToolContext,
  raw: Readonly<Record<string, unknown>>,
  options: RunToolOptions = {},
): Promise<ToolOutcome> {
  const tool = await resolveTool(toolId);
  if (!tool) {
    return refuse(
      `Unknown tool “${toolId}”.`,
      parseMcpToolId(toolId)
        ? 'That connection is missing, switched off, or has not been connected since the tool appeared.'
        : 'No tool with that id is declared.',
    );
  }

  const kind = spaceKindOf(ctx);
  if (!kind) {
    return refuse(
      `${tool.label} cannot run here.`,
      'Shared capability memory holds generalised lessons, never runnable records.',
    );
  }
  if (!tool.scopeKinds.includes(kind)) {
    return refuse(
      `${tool.label} does not apply to a ${kind} space.`,
      `${tool.label} is only available in: ${tool.scopeKinds.join(', ')}.`,
    );
  }

  const validation = validateArgs(tool, raw);
  if (!validation.ok) {
    return refuse(`${tool.label} was not run.`, validation.errors.join('; '));
  }

  const smuggled = smuggledSecretParams(tool, validation.coerced);
  if (smuggled.length > 0) {
    return refuse(
      `${tool.label} was not run.`,
      `A {{secret:…}} placeholder appeared in ${smuggled.join(', ')}, which does not accept one. A secret reference belongs only in a parameter declared to take it.`,
    );
  }

  if (requiresApproval(tool.risk, await approvalPolicy()) && !options.approval) {
    return refuse(
      `${tool.label} is waiting for your decision.`,
      `${tool.label} is ${tool.risk}. It does not run until a human decision is recorded against it.`,
    );
  }

  const remote = parseMcpToolId(tool.id) !== null;
  const executor = remote ? undefined : EXECUTORS[tool.id as ToolId];
  if (!remote && !executor) {
    return refuse(`${tool.label} has no executor.`, 'No executor is registered for that tool.');
  }

  let outcome: ToolOutcome;
  try {
    outcome = remote
      ? await executeMcpTool(tool, ctx, validation.coerced)
      : await executor!(ctx, validation.coerced);
  } catch (error) {
    outcome = refuse(
      `${tool.label} failed.`,
      error instanceof Error ? error.message : 'The executor threw a non-error value.',
    );
  }

  return scrub(tool, outcome);
}

function smuggledSecretParams(tool: ToolDefinition, args: ToolArgs): string[] {
  const offenders: string[] = [];
  for (const param of tool.params) {
    if (param.acceptsSecret) continue;
    const value = args[param.name];
    if (typeof value === 'string' && referencedSecretNames(value).length > 0) {
      offenders.push(param.name);
    }
  }
  return offenders;
}

/**
 * Last line of defence, not the first.
 *
 * Nothing should put plaintext into an outcome — executors resolve a secret,
 * use it, and drop it. But this outcome is about to be written into a `ToolCall`
 * and rendered, so for any tool that can hold a credential at all the text is
 * checked against the vault before it is returned.
 */
async function scrub(tool: ToolDefinition, outcome: ToolOutcome): Promise<ToolOutcome> {
  // Any remote call may carry a secret through an env var or a header that is
  // not a declared param, so a param-shape check misses those. Scrub every MCP
  // outcome; for built-ins, keep the cheap param gate.
  const remote = parseMcpToolId(tool.id) !== null;
  if (!remote && !tool.params.some((param) => param.acceptsSecret)) return outcome;

  const values = await allSecretValues();
  if (values.length === 0) return outcome;

  return {
    ...outcome,
    summary: redact(outcome.summary, values),
    ...(outcome.error ? { error: redact(outcome.error, values) } : {}),
  };
}
