/**
 * The tool layer — how the Executive Assistant changes things.
 *
 * Until now the assistant could read the workspace and reason about it. Tools are
 * how it *acts*: creating a task, arming an automation, recording a decision,
 * spinning up a company. Everything it can do is declared here as data, which
 * means the set of possible actions is enumerable, auditable, and — critically —
 * gated by risk tier rather than by hoping the model behaves.
 *
 * The rule that governs all of it: a tool's risk tier decides whether it runs.
 * `read` and `write` touch only this workspace and execute immediately.
 * `destructive` and `external` stop and wait for a recorded human decision, the
 * same gate the Safe Upgrade Pipeline uses. There is no tool that can bypass it,
 * because the executor consults the tier, not the caller.
 */

import type { Scope } from './scope';
import type { ScopedRecord, Timestamp } from './work';

/* ------------------------------------------------------------- risk ------- */

export const RISK_TIERS = ['read', 'write', 'destructive', 'external'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** Tiers the assistant may execute on its own. Everything else needs a human. */
export const AUTONOMOUS_RISK_TIERS: readonly RiskTier[] = ['read', 'write'];

/**
 * Founder settings that affect the gate.
 *
 * Note what is absent and will stay absent: there is no option that makes
 * `destructive` or `external` autonomous. This type can only ever tighten, which
 * is why it is safe to hand it to a settings form.
 */
export interface ApprovalPolicy {
  /** Hold `write` tools for approval too, not just the two gated tiers. */
  readonly confirmWrites?: boolean;
}

export function requiresApproval(risk: RiskTier, policy: ApprovalPolicy = {}): boolean {
  if (!AUTONOMOUS_RISK_TIERS.includes(risk)) return true;
  return policy.confirmWrites === true && risk === 'write';
}

export const RISK_EXPLANATION: Record<RiskTier, string> = {
  read: 'Only reads. Changes nothing.',
  write: 'Creates or updates records inside this workspace. Reversible, and never leaves your machine.',
  destructive: 'Deletes or overwrites something that cannot be recovered from inside OmniOS.',
  external: 'Would reach outside OmniOS — sending, publishing, paying, or calling a third party.',
};

/* ------------------------------------------------------- parameters ------- */

export const PARAM_TYPES = ['string', 'text', 'number', 'boolean', 'enum', 'date', 'scope'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export interface ToolParam {
  readonly name: string;
  readonly type: ParamType;
  readonly description: string;
  readonly required: boolean;
  readonly enumValues?: readonly string[];
  readonly default?: string | number | boolean;
  /** Names a secret this parameter accepts as `{{secret:NAME}}`. Resolved at execution only. */
  readonly acceptsSecret?: boolean;
}

export type ToolArgs = Readonly<Record<string, string | number | boolean | undefined>>;

/* ------------------------------------------------------------ tools ------- */

export interface ToolDefinition {
  readonly id: string;
  readonly label: string;
  /** Written for the router and for a model: what it does and when to reach for it. */
  readonly description: string;
  readonly risk: RiskTier;
  readonly capabilityId: string;
  readonly scopeKinds: readonly ('company' | 'personal')[];
  readonly params: readonly ToolParam[];
  /** Phrases that suggest this tool, scored the same way specialists are. */
  readonly matches: readonly string[];
  /**
   * A plain-language sentence describing exactly what this call would do,
   * rendered *before* anything happens. Approval without a preview is theatre.
   */
  readonly preview: (args: ToolArgs) => string;
}

export const TOOL_CALL_STATUSES = [
  'executed',
  'awaiting-approval',
  'approved',
  'rejected',
  'failed',
  'skipped',
] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export interface ToolCall extends ScopedRecord {
  readonly toolId: string;
  readonly args: ToolArgs;
  readonly status: ToolCallStatus;
  readonly risk: RiskTier;
  /** What the call said it would do, captured before it ran. */
  readonly preview: string;
  /** What actually happened. Absent while awaiting approval. */
  readonly result?: string;
  readonly error?: string;
  /** Ids of records this call created or changed, so it can be traced or undone. */
  readonly affectedIds: readonly string[];
  readonly at: Timestamp;
  readonly decidedAt?: Timestamp;
  readonly decidedBy?: string;
  /** The run that produced this call, when it came from the assistant. */
  readonly runId?: string;
  /** The standing grant that let this call run without a per-call decision. */
  readonly grantId?: string;
}

export interface ToolOutcome {
  readonly ok: boolean;
  readonly summary: string;
  readonly affectedIds?: readonly string[];
  readonly error?: string;
}

/** Everything an executor is handed. Deliberately narrow: no raw store access. */
export interface ToolContext {
  readonly scope: Scope;
  readonly now: Date;
  readonly actor: string;
  /**
   * Resolves `{{secret:NAME}}` placeholders. Only executors for tools whose
   * params declare `acceptsSecret` ever call it, and the resolved value is never
   * written back into the ToolCall record.
   */
  readonly resolveSecrets: (value: string) => Promise<string>;
}

export type ToolExecutor = (ctx: ToolContext, args: ToolArgs) => Promise<ToolOutcome>;

/* --------------------------------------------------------- validation ----- */

export interface ArgValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly coerced: ToolArgs;
}

/**
 * Validate and coerce arguments against a tool's declared parameters.
 *
 * Runs on the server against whatever arrived, whether that was a form, a
 * model's structured output, or a crafted request. Unknown keys are dropped
 * rather than passed through — an executor should never see a field its tool
 * did not declare.
 */
export function validateArgs(tool: ToolDefinition, raw: Readonly<Record<string, unknown>>): ArgValidation {
  const errors: string[] = [];
  const coerced: Record<string, string | number | boolean | undefined> = {};

  for (const param of tool.params) {
    const value = raw[param.name];

    if (value === undefined || value === null || value === '') {
      if (param.required && param.default === undefined) {
        errors.push(`${param.name} is required`);
      } else if (param.default !== undefined) {
        coerced[param.name] = param.default;
      }
      continue;
    }

    switch (param.type) {
      case 'number': {
        const n = typeof value === 'number' ? value : Number(String(value));
        if (Number.isNaN(n)) errors.push(`${param.name} must be a number`);
        else coerced[param.name] = n;
        break;
      }
      case 'boolean': {
        coerced[param.name] = value === true || value === 'true' || value === 'on';
        break;
      }
      case 'enum': {
        const s = String(value);
        if (param.enumValues && !param.enumValues.includes(s)) {
          errors.push(`${param.name} must be one of: ${param.enumValues.join(', ')}`);
        } else {
          coerced[param.name] = s;
        }
        break;
      }
      case 'date': {
        const s = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) errors.push(`${param.name} must be a date (YYYY-MM-DD)`);
        else coerced[param.name] = s;
        break;
      }
      default: {
        const s = String(value).trim();
        // A generous ceiling that still stops a runaway model writing a novel
        // into a task title and bloating the scope file.
        coerced[param.name] = s.slice(0, param.type === 'text' ? 8000 : 500);
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors, coerced };
}
