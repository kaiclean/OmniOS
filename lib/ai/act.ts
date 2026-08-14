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

import type { LlmMessage, LlmProvider, LlmToolSchema, Scope, ToolDefinition } from '@/lib/domain';
import { parseMcpToolId } from '@/lib/domain';
import { scoreTools, toolsForScope } from './tools';

export interface PlannedCall {
  readonly toolId: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ActDecision {
  readonly mode: 'answer' | 'act';
  readonly calls: readonly PlannedCall[];
  /** Set when the founder clearly wanted an action the local path cannot parse. */
  readonly note?: string;
  /**
   * 'command' when the founder asked for something to be *done* and a specific
   * tool was identified — whether or not it could run. The reply for a command
   * is a receipt of what happened, not a capability briefing; without this flag
   * the assistant answered "/task …" with a marketing report.
   */
  readonly intent?: 'command';
}

/**
 * A provider-legal function name for a tool.
 *
 * Both the Anthropic and OpenAI tool APIs constrain a function name to
 * `^[a-zA-Z0-9_-]{1,64}$`, and a bridged connection tool's id is
 * `mcp:<server>:<tool>` — colons and all. So every remote tool was offered to
 * the model under a name the wire format does not permit, and the model could
 * not call any of them. Fourteen filesystem tools sat connected, correctly
 * tiered and completely unreachable: asked to read a file, the assistant
 * searched its own records instead and reported it had no way.
 *
 * The mapping is one-way, so callers must resolve the model's answer through
 * {@link toolCatalogue} rather than reversing this by hand.
 */
export function schemaName(toolId: string): string {
  return toolId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

/** FNV-1a, matching `makeRecordId`'s family, so a collision suffix is stable. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

export interface ToolCatalogue {
  readonly schemas: readonly LlmToolSchema[];
  /** Wire name → tool id. A name absent from this map is dropped, never guessed. */
  readonly byName: ReadonlyMap<string, string>;
}

export function toolCatalogue(tools: readonly ToolDefinition[]): ToolCatalogue {
  const schemas: LlmToolSchema[] = [];
  const byName = new Map<string, string>();
  for (const tool of tools) {
    let name = schemaName(tool.id);
    if (byName.has(name)) {
      // Two ids can sanitise to the same name. Disambiguate deterministically
      // rather than letting the later one shadow the earlier — silently routing
      // a call to the wrong tool is the worst failure available here.
      name = `${name.slice(0, 57)}_${shortHash(tool.id)}`;
    }
    byName.set(name, tool.id);
    schemas.push({ ...toolJsonSchema(tool), name });
  }
  return { schemas, byName };
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

/**
 * A ceiling, not a filter.
 *
 * High enough that the whole built-in registry plus a typical connection always
 * fits — truncation silently removes abilities, and the failure is invisible:
 * a tool sliced off the end is a tool the model cannot call and cannot report
 * missing. A tighter cap once dropped `delete_record` and turned "the loop halts
 * on a gated call" from a safety property into a passing test that proved
 * nothing. It exists only so a server advertising hundreds of tools cannot make
 * one request unbounded.
 */
const SHORTLIST_MAX = 64;

function shortlistBand(
  tools: readonly ToolDefinition[],
  keep: (tool: ToolDefinition) => boolean,
): ToolDefinition[] {
  return tools.filter(keep);
}

/** Verbs that signal the founder wants something done, not described. */
const IMPERATIVE_HINTS =
  /^(create|add|make|start|track|record|log|schedule|write|set up|set|remember|remind|delete|remove|reset|wipe|clear|archive|send|publish|post|arm|pause|complete|finish|mark)\b/i;

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

  // Enum words are matched outside the quoted title — "delete that 'goal
  // notes'" names a record, not the goals collection.
  const outsideQuotes = trimmed.replace(QUOTED, ' ');
  for (const param of top.tool.params) {
    if (param.type !== 'enum' || !param.enumValues || args[param.name] !== undefined) continue;
    // "the task" must find the 'tasks' collection: enum words are matched in
    // singular and plural, because founders speak about one thing at a time.
    const hit = param.enumValues.find((value) => {
      const stem = value.endsWith('s') ? value.slice(0, -1) : value;
      return new RegExp(`\\b${stem}s?\\b`, 'i').test(outsideQuotes);
    });
    if (hit) args[param.name] = hit;
  }

  const missing = top.tool.params.filter(
    (p) => p.required && p.default === undefined && args[p.name] === undefined,
  );
  if (missing.length > 0) {
    // Missing pieces are named in the founder's language — a param name like
    // "collection" is ours, not theirs — and the example must itself parse.
    const wanted = missing
      .map((p) => (p.description ? (p.description.split(',')[0] ?? p.name).replace(/\.$/, '').toLowerCase() : p.name))
      .join('; ');
    const example = top.tool.matches.find((m) => m.split(' ').some((w) => new RegExp(`\\b${w}\\b`, 'i').test(trimmed))) ?? top.tool.matches[0] ?? top.tool.label;
    return {
      mode: 'answer',
      calls: [],
      intent: 'command',
      note: `I can ${top.tool.label.toLowerCase()}, but I am missing: ${wanted}. Say it like: ${example} “…”.`,
    };
  }

  return { mode: 'act', intent: 'command', calls: [{ toolId: top.tool.id, args }] };
}

const ACT_SYSTEM = `You translate a founder's instruction into tool calls inside their operating system, or decide none is wanted.

You are called repeatedly. What you plan runs, and you are asked again with the results, so you do not have to solve everything in one step — find out, then act on what you found.

Rules that are not yours to bend:
- Plan a call only when the founder clearly asked for something to be done. A question about their records is still something to be done: look it up rather than guessing.
- Reading is free. A tool that only reads changes nothing and needs no permission, so prefer looking over asking the founder to repeat themselves. If you do not know a path, an id or a filename, use a read tool to find it before giving up.
- Facts are never yours to invent: an amount of money, a date something happened, a recipient, an address, a real person or company outside this workspace. Those come from the founder's words or from records you read — a write built on a guessed fact corrupts their books.
- Choices the founder handed to you are yours to make. "You decide", "draft it", "name it", "set it up", "you run it", "make a plan" delegate the naming and the content: do the work, choose sensible specifics, and let the receipts say what you chose. Meeting a delegation with a questionnaire is refusing the job.
- At most 3 calls per step. When a write needs a fact you do not have, do the parts that are clear and name the one thing missing — never let one gap park the whole instruction. When unsure about a read, just read.`;


export async function detectAct(
  prompt: string,
  options: {
    readonly scope: Scope | null;
    readonly provider: LlmProvider;
    readonly now: Date;
    readonly preferCapabilityId?: string;
    /**
     * The tools genuinely available for this call, built-in *and* bridged from
     * connections. Passed in rather than derived, because `toolsForScope` knows
     * only the static registry — a connected MCP server's tools live on the
     * workspace, and a planner that cannot see them will confidently tell the
     * founder it has no way to read their files while a filesystem server sits
     * connected two feet away. Defaults to the built-ins so existing callers and
     * the tests keep their old behaviour.
     */
    readonly tools?: readonly ToolDefinition[];
    /**
     * The last few turns of this conversation, oldest first. Without them the
     * planner sees one sentence with no past: the assistant asks "which model —
     * fixed-price or retainer?", the founder answers "the first one", and the
     * planner receives three words it cannot possibly act on. The answering
     * half has carried history for a while; the acting half was the amnesiac.
     */
    readonly history?: readonly LlmMessage[];
  },
): Promise<ActDecision> {
  const { scope, provider, now, preferCapabilityId } = options;

  if (!provider.completeWithTools) return detectActLocally(prompt, scope, now, preferCapabilityId);

  // The shortlist keeps the request small and the model honest: it can only
  // pick from tools that already looked plausible for this sentence and scope.
  //
  // With one deliberate exception. Every `read` tool is always offered, whatever
  // the sentence scored, because the ability to *find something out* must not
  // depend on the founder phrasing their question the way the keyword matcher
  // expects. Without this the scorer became a veto on the model's judgement:
  // "is the auditor tracked?" matched nothing, so the model was never asked, and
  // the assistant answered from whatever happened to be pre-loaded rather than
  // looking. A read changes nothing, so offering it costs nothing.
  const available = options.tools ?? (scope ? toolsForScope(scope) : []);
  if (available.length === 0) return { mode: 'answer', calls: [] };

  const rank = new Map(
    scoreTools(prompt, scope ?? undefined, preferCapabilityId ? { preferCapabilityId } : {}).map(
      (entry, index) => [entry.tool.id, index],
    ),
  );
  // Three bands, then a cap. Scored tools first — the keyword matcher is a good
  // hint. Then every connection tool, ahead of the unscored built-ins, because a
  // bridged tool's match phrases are only its own name and its server's, so it
  // scores zero however relevant it is. Offered forty-six tools with fourteen
  // filesystem ones sorted last, the model read straight past them and searched
  // the workspace six times instead. Unscored built-ins fill whatever is left.
  const scoredTools = shortlistBand(available, (tool) => rank.has(tool.id));
  const remoteTools = shortlistBand(available, (tool) => !rank.has(tool.id) && tool.id.startsWith('mcp:'));
  const restTools = shortlistBand(
    available,
    (tool) => !rank.has(tool.id) && !tool.id.startsWith('mcp:'),
  );
  scoredTools.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  const shortlist = [...scoredTools, ...remoteTools, ...restTools].slice(0, SHORTLIST_MAX);
  const catalogue = toolCatalogue(shortlist);

  // Naming the connections explicitly, because ordering alone does not surface
  // them: bridged tools score near zero (their match phrases are just the tool
  // and server names), so they sort behind thirty built-ins and the model reads
  // straight past them. Offered fourteen filesystem tools among forty-six, it
  // searched the workspace six times and reported it had no way to read a file
  // — the tools were there and it never saw them.
  const connections = [
    ...new Set(
      shortlist
        .map((tool) => parseMcpToolId(tool.id)?.serverId)
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const connectionLine =
    connections.length > 0
      ? `\n\nConnected servers you can reach, beyond this workspace: ${connections.join(', ')}. Their tools are named mcp_<server>_<tool>. When the founder mentions a file, a page, a repository or anything that lives outside their OmniOS records, use those — and if you do not know a path or an id, call a listing or search tool on that server first.`
      : '';

  try {
    const response = await provider.completeWithTools(
      {
        messages: [
          { role: 'system', content: `${ACT_SYSTEM}${connectionLine}` },
          ...(options.history ?? []),
          { role: 'user', content: `Today is ${now.toISOString().slice(0, 10)}. The founder said: "${prompt.trim()}"` },
        ],
        maxTokens: 600,
      },
      catalogue.schemas,
    );

    const calls = response.calls
      .map((call) => ({ toolId: catalogue.byName.get(call.name), args: call.args }))
      .filter((call): call is { toolId: string; args: Readonly<Record<string, unknown>> } =>
        call.toolId !== undefined,
      )
      .slice(0, 3);

    // Reads serve questions; anything else means the founder asked for a change,
    // and the reply should be a receipt of it rather than a briefing.
    const command = calls.some((call) => {
      const tool = shortlist.find((t) => t.id === call.toolId);
      return tool !== undefined && tool.risk !== 'read';
    });
    return calls.length > 0
      ? { mode: 'act', calls, ...(command ? { intent: 'command' as const } : {}) }
      : { mode: 'answer', calls: [] };
  } catch {
    // A provider failure must never lose the turn — the local path still stands.
    return detectActLocally(prompt, scope, now, preferCapabilityId);
  }
}
