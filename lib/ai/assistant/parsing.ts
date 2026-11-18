import 'server-only';

/**
 * Reading what the founder typed: the result shape, @mentions and slash commands.
 */

import {
  agentIdFrom,
  type AgentRun,
  type AssistantMessage,
  type DelegationPlan,
  type SpecialistAgent,
} from '@/lib/domain';
import { SLASH_COMMANDS } from '../commands';

export interface AskResult {
  readonly message: AssistantMessage;
  readonly plan: DelegationPlan;
  readonly run: AgentRun;
}

/**
 * "@engineer how risky is this migration" — the founder names the voice.
 *
 * A mention only re-weights who *answers*; it grants nothing. The named
 * specialist must already be on the roster this target may use, and an unknown
 * slug is left in the text rather than guessed at.
 */
export function parseMention(
  prompt: string,
  roster: readonly SpecialistAgent[],
): { specialist: SpecialistAgent; rest: string } | null {
  const match = /^@([a-z0-9][a-z0-9-]*)\s+(.+)$/s.exec(prompt.trim());
  if (!match?.[1] || !match[2]) return null;
  const slug = match[1];
  const specialist = roster.find(
    (candidate) => candidate.id === slug || agentIdFrom(candidate.name) === slug,
  );
  return specialist ? { specialist, rest: match[2].trim() } : null;
}

/**
 * Slash commands are the deterministic fast path: no model, no routing
 * ambiguity — "/task Buy the domain" is exactly one proposal, validated and
 * gated like anything else. The registry lives in `./commands` so the composer
 * lists exactly what the server parses; each entry owns its parse, so a
 * command can carry more than one argument (a doc's body, an amount and a
 * label) without any of it becoming model territory.
 */
export function parseSlashCommand(
  prompt: string,
): { toolId: string; args: Record<string, string | number>; label: string; parseError?: string } | null {
  const match = /^\/([a-z]+)\s+(.+)$/s.exec(prompt.trim());
  if (!match?.[1] || !match[2]) return null;
  const entry = SLASH_COMMANDS.find((candidate) => candidate.command === match[1]);
  if (!entry) return null;
  const parsed = entry.parse(match[2]);
  if (!parsed.ok || !parsed.args) {
    return { toolId: entry.toolId, args: {}, label: entry.command, parseError: parsed.error ?? 'That did not parse.' };
  }
  return { toolId: entry.toolId, args: { ...parsed.args }, label: entry.command };
}
