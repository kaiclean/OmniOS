'use server';

import { revalidatePath } from 'next/cache';

import type { LaunchStep } from '@/lib/business/playbook';
import { BUSINESS_MODELS, buildLaunchProgram, type BusinessModel } from '@/lib/business/playbook';
import { mcpToolDefinitions } from '@/lib/ai/tools/mcp-bridge';
import { companyScope } from '@/lib/domain';
import type { ToolArgs, ToolDefinition } from '@/lib/domain';
import { getWorkspace } from '@/lib/data/store';
import { proposeToolCall } from './tools';

/**
 * Running a launch programme.
 *
 * This is the closest OmniOS gets to "the assistant runs the business", and the
 * shape of it is the argument: the internal half executes unattended and
 * genuinely produces the strategy, the numbers, the roadmap and the risks; the
 * outward half is prepared, matched against the connections that actually exist,
 * and queued for a decision.
 *
 * Three outcomes per outward step, and the third is the one that matters most:
 *
 * - a connected tool matches → the call is proposed and waits for approval;
 * - a tool matches but its required arguments cannot be filled from the plan →
 *   reported as needing arguments, rather than proposed half-built;
 * - nothing matches → reported as a gap naming what is missing.
 *
 * A gap is never silently dropped. The point of this feature is to be trusted
 * with credentials, and a system that quietly skips the step it could not do is
 * not trustworthy with them.
 */

/** Parameters an outward call's main text can reasonably land on, best first. */
const PAYLOAD_PARAMS = [
  'text',
  'content',
  'body',
  'message',
  'prompt',
  'query',
  'q',
  'search',
  'description',
  'input',
];

/**
 * Match a step's need against the tools on connected servers.
 *
 * Deliberately conservative: a hint has to appear in the tool's name, not merely
 * somewhere in its description, because a description mentioning "post" is not
 * evidence that a tool posts anything.
 */
function matchTool(step: LaunchStep, available: readonly ToolDefinition[]): ToolDefinition | undefined {
  const hints = step.need?.toolNameHints ?? [];
  if (hints.length === 0) return undefined;

  const scored = available
    .map((tool) => {
      const name = (tool.id.split(':').slice(2).join(':') || tool.id).toLowerCase();
      const index = hints.findIndex((hint) => name.includes(hint.toLowerCase()));
      return { tool, rank: index === -1 ? Number.POSITIVE_INFINITY : index };
    })
    .filter((entry) => Number.isFinite(entry.rank))
    // Earlier hints are the better match, and a capability match breaks a tie.
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const aOwn = a.tool.capabilityId === step.capabilityId ? 0 : 1;
      const bOwn = b.tool.capabilityId === step.capabilityId ? 0 : 1;
      return aOwn - bOwn;
    });

  return scored[0]?.tool;
}

/**
 * Fill what can be filled from the plan.
 *
 * Returns null when a required parameter cannot be supplied — proposing a call
 * that is guaranteed to fail validation would fill the approvals inbox with
 * noise and teach a founder to click through it.
 */
function argsForRemoteCall(step: LaunchStep, tool: ToolDefinition): ToolArgs | null {
  const payload = step.need?.payload ?? step.need?.intent ?? step.title;
  const args: Record<string, string | number | boolean> = {};

  const target =
    tool.params.find((param) => PAYLOAD_PARAMS.includes(param.name.toLowerCase())) ??
    tool.params.find((param) => param.required && (param.type === 'string' || param.type === 'text'));

  if (target) args[target.name] = payload;

  for (const param of tool.params) {
    if (!param.required || args[param.name] !== undefined) continue;
    if (param.default !== undefined) {
      args[param.name] = param.default;
      continue;
    }
    if (param.type === 'enum' && param.enumValues?.[0] !== undefined) {
      args[param.name] = param.enumValues[0];
      continue;
    }
    return null;
  }

  return args;
}

export interface LaunchStepResult {
  readonly stepId: string;
  readonly title: string;
  readonly why: string;
  readonly capabilityId: string;
  readonly outcome: 'done' | 'awaiting-approval' | 'needs-connection' | 'needs-arguments' | 'failed';
  readonly detail: string;
  /** The connection that would run it, when one was found. */
  readonly toolLabel?: string;
}

export interface LaunchReport {
  readonly companyId: string;
  readonly model: BusinessModel;
  readonly ranAt: string;
  readonly results: readonly LaunchStepResult[];
}

export async function runLaunchProgram(
  companyId: string,
  modelInput: string,
  options: { readonly testBudgetMinor?: number } = {},
): Promise<LaunchReport | null> {
  const workspace = await getWorkspace();
  // Never trust an id from the browser: it is resolved through the workspace,
  // and a company that is not there simply has no scope to write into.
  const company = workspace.companies.find((candidate) => candidate.id === companyId);
  if (!company) return null;

  const model: BusinessModel = BUSINESS_MODELS.includes(modelInput as BusinessModel)
    ? (modelInput as BusinessModel)
    : 'agency';

  const now = new Date();
  const scope = companyScope(company.id);
  const steps = buildLaunchProgram({
    companyName: company.name,
    companyId: company.id,
    model,
    oneLiner: company.description || company.dna.mission || `${company.name}, newly created in OmniOS.`,
    currency: company.baseCurrency,
    testBudgetMinor: options.testBudgetMinor ?? 200_000,
    startDate: now.toISOString().slice(0, 10),
  });

  const available = mcpToolDefinitions(workspace.mcpServers, workspace.mcpStates);
  const results: LaunchStepResult[] = [];

  for (const step of steps) {
    const base = {
      stepId: step.id,
      title: step.title,
      why: step.why,
      capabilityId: step.capabilityId,
    };

    if (step.kind === 'internal') {
      if (!step.toolId) {
        results.push({ ...base, outcome: 'failed', detail: 'The step declares no tool.' });
        continue;
      }
      const proposed = await proposeToolCall(scope, step.toolId, step.args ?? {}, { now });
      results.push({
        ...base,
        outcome: proposed.ok ? (proposed.awaitingApproval ? 'awaiting-approval' : 'done') : 'failed',
        detail: proposed.summary,
      });
      continue;
    }

    const tool = matchTool(step, available);
    if (!tool) {
      results.push({
        ...base,
        outcome: 'needs-connection',
        detail: `${step.need?.intent ?? step.title} Nothing connected can do this yet${
          step.need?.presetId ? ` — the ${step.need.presetId} preset on Connections is the usual answer` : ''
        }.`,
      });
      continue;
    }

    const args = argsForRemoteCall(step, tool);
    if (!args) {
      results.push({
        ...base,
        outcome: 'needs-arguments',
        toolLabel: tool.label,
        detail: `${tool.label} could do this, but it requires arguments the plan cannot supply. Run it yourself from the tool with the values it needs.`,
      });
      continue;
    }

    const proposed = await proposeToolCall(scope, tool.id, args, { now });
    results.push({
      ...base,
      outcome: proposed.ok ? (proposed.awaitingApproval ? 'awaiting-approval' : 'done') : 'failed',
      toolLabel: tool.label,
      detail: proposed.summary,
    });
  }

  revalidatePath('/', 'layout');
  return { companyId: company.id, model, ranAt: now.toISOString(), results };
}
