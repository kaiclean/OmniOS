import 'server-only';

/**
 * Turning a sentence into a plan the gate can judge.
 *
 * Two paths to the same door. With a model, the prompt and a shortlist of tool
 * schemas go through function-calling and the model *plans* calls. Without,
 * `scoreTools` plus plain heuristics handle the common phrasings. Either way,
 * what comes back is only ever a plan: every call is validated, previewed and
 * gated by `proposeCore` exactly as if the founder had typed it into a form.
 * The model cannot choose the scope, cannot see a secret, and cannot make a
 * gated tier run — those properties live below this file, which is why it is
 * allowed to be wrong.
 */

import type { LlmProvider, LlmToolSchema, Scope, ToolDefinition } from '@/lib/domain';
import { scoreTools } from './tools';

export interface PlannedCall {
  readonly toolId: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ActDecision {
  readonly mode: 'answer' | 'act';
  readonly calls: readonly PlannedCall[];
  /** Set when the founder clearly wanted an action the local path cannot parse. */
  readonly note?: string;
}

/** A ToolDefinition's params, as the JSON Schema function-calling expects. */
export function toolJsonSchema(tool: ToolDefinition): LlmToolSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of tool.params) {
    properties[param.name] = {
      type: param.type === 'number' ? 'number' : param.type === 'boolean' ? 'boolean' : 'string',
      description: param.description,
      ...(param.enumValues ? { enum: [...param.enumValues] } : {}),
    };
    if (param.required && param.default === undefined) required.push(param.name);
  }
  return {
    name: tool.id,
    description: tool.description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
  };
}

/** Verbs that signal the founder wants something done, not described. */
const IMPERATIVE_HINTS =
  /^(create|add|make|start|track|record|log|schedule|write|set up|set|remember|remind|delete|remove|send|publish|post|arm|pause|complete|finish|mark)\b/i;

const QUOTED = /["“”']([^"“”']{2,120})["“”']/;
const CALLED = /\b(?:called|named|titled)\s+(.{2,80}?)(?:\s+(?:due|by|for|with|at|priority)\b|[.!?]|$)/i;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

function tomorrow(now: Date): string {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The local path: honest about its limits. It extracts what plain patterns can
 * carry — a quoted or "called X" title, an explicit or relative date, an enum
 * word that appears verbatim — and refuses the rest with a note rather than
 * guessing a payload the founder never said.
 */
export function detectActLocally(prompt: string, scope: Scope | null, now: Date, preferCapabilityId?: string): ActDecision {
  const trimmed = prompt.trim();
  if (!IMPERATIVE_HINTS.test(trimmed)) return { mode: 'answer', calls: [] };

  const scores = scoreTools(trimmed, scope ?? undefined, preferCapabilityId ? { preferCapabilityId } : {});
  const top = scores[0];
  if (!top || top.score < 4) {
    return {
      mode: 'answer',
      calls: [],
      note: 'That reads like a command, but I could not turn it into a specific action on my own. With a model key connected I can handle freer phrasing; for now, try naming the thing, e.g. “create a task called …”.',
    };
  }

  const args: Record<string, unknown> = {};
  const title = QUOTED.exec(trimmed)?.[1] ?? CALLED.exec(trimmed)?.[1];
  const titleParam = top.tool.params.find((p) => p.required && (p.type === 'string' || p.type === 'text'));
  if (titleParam && title) args[titleParam.name] = title.trim();

  const dateParam = top.tool.params.find((p) => p.type === 'date');
  if (dateParam) {
    const explicit = DATE.exec(trimmed)?.[1];
    if (explicit) args[dateParam.name] = explicit;
    else if (/\btomorrow\b/i.test(trimmed)) args[dateParam.name] = tomorrow(now);
  }

  for (const param of top.tool.params) {
    if (param.type !== 'enum' || !param.enumValues || args[param.name] !== undefined) continue;
    const hit = param.enumValues.find((value) => new RegExp(`\\b${value}\\b`, 'i').test(trimmed));
    if (hit) args[param.name] = hit;
  }

  const missing = top.tool.params.filter(
    (p) => p.required && p.default === undefined && args[p.name] === undefined,
  );
  if (missing.length > 0) {
    return {
      mode: 'answer',
      calls: [],
      note: `I can ${top.tool.label.toLowerCase()}, but I need ${missing.map((p) => p.name).join(' and ')} — say it like: ${top.tool.matches[0] ?? top.tool.label} “…”.`,
    };
  }

  return { mode: 'act', calls: [{ toolId: top.tool.id, args }] };
}

const ACT_SYSTEM = `You translate a founder's instruction into tool calls inside their operating system, or decide none is wanted.

Rules that are not yours to bend:
- Plan a call only when the founder clearly asked for something to be done. A question gets no calls.
- Use only the offered tools and only arguments the founder actually stated or that follow trivially (like "tomorrow" as a date). Never invent titles, amounts, dates or names.
- At most 3 calls. When unsure, plan nothing — the founder would rather repeat themselves than undo you.`;

export async function detectAct(
  prompt: string,
  options: {
    readonly scope: Scope | null;
    readonly provider: LlmProvider;
    readonly now: Date;
    readonly preferCapabilityId?: string;
  },
): Promise<ActDecision> {
  const { scope, provider, now, preferCapabilityId } = options;

  if (!provider.completeWithTools) return detectActLocally(prompt, scope, now, preferCapabilityId);

  // The shortlist keeps the request small and the model honest: it can only
  // pick from tools that already looked plausible for this sentence and scope.
  const shortlist = scoreTools(prompt, scope ?? undefined, preferCapabilityId ? { preferCapabilityId } : {})
    .slice(0, 12)
    .map((entry) => entry.tool);
  if (shortlist.length === 0) return { mode: 'answer', calls: [] };

  try {
    const response = await provider.completeWithTools(
      {
        messages: [
          { role: 'system', content: ACT_SYSTEM },
          { role: 'user', content: `Today is ${now.toISOString().slice(0, 10)}. The founder said: "${prompt.trim()}"` },
        ],
        maxTokens: 600,
      },
      shortlist.map(toolJsonSchema),
    );

    const allowed = new Set(shortlist.map((tool) => tool.id));
    const calls = response.calls
      .filter((call) => allowed.has(call.name))
      .slice(0, 3)
      .map((call) => ({ toolId: call.name, args: call.args }));

    return calls.length > 0 ? { mode: 'act', calls } : { mode: 'answer', calls: [] };
  } catch {
    // A provider failure must never lose the turn — the local path still stands.
    return detectActLocally(prompt, scope, now, preferCapabilityId);
  }
}
