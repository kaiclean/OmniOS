/**
 * Looking up and choosing tools.
 *
 * Client-safe on purpose: this file and `registry.ts` are pure data and pure
 * functions, so the command palette, the approval sheet and the tests can all
 * reason about the tool catalogue without pulling in `executors.ts`, which is
 * `server-only` and touches the store.
 *
 * `scoreTools` deliberately mirrors `scoreSpecialists` in `../router.ts`: same
 * stopwords, same phrase-over-keyword weighting, same early-match bonus. A tool
 * and a specialist competing for the same sentence should be scored the same way,
 * otherwise the two rankings cannot be compared.
 */

import type { Scope, ToolDefinition } from '@/lib/domain';
import { TOOLS } from './registry';

export * from './registry';

const BY_ID = new Map<string, ToolDefinition>(TOOLS.map((tool) => [tool.id, tool]));

export function getTool(id: string): ToolDefinition | undefined {
  return BY_ID.get(id);
}

export function toolIds(): string[] {
  return TOOLS.map((tool) => tool.id);
}

/**
 * Tools available in a scope.
 *
 * A shared capability scope gets none. Shared memory holds generalised lessons,
 * not runnable records — the same refusal `lib/actions/automations.ts` makes.
 */
export function toolsForScope(scope: Scope): ToolDefinition[] {
  if (scope.kind === 'shared') return [];
  const kind = scope.kind;
  return TOOLS.filter((tool) => tool.scopeKinds.includes(kind));
}

export function toolsForScopeKind(kind: 'company' | 'personal'): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.scopeKinds.includes(kind));
}

export function toolsForCapability(capabilityId: string): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.capabilityId === capabilityId);
}

/* ---------------------------------------------------------------- scoring -- */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'my', 'me', 'i',
  'we', 'do', 'should', 'what', 'how', 'can', 'you', 'this', 'that', 'with', 'about', 'please',
]);

export interface ToolScore {
  readonly tool: ToolDefinition;
  readonly score: number;
  readonly matched: readonly string[];
}

/**
 * Rank tools against a prompt.
 *
 * Ranking is a suggestion, never a licence: a `destructive` or `external` tool
 * can top this list and still not run, because execution consults
 * `requiresApproval(tool.risk)` rather than the score.
 */
export function scoreTools(prompt: string, scope?: Scope): ToolScore[] {
  const text = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const words = new Set(text.split(/[^a-z0-9']+/).filter((w) => w && !STOPWORDS.has(w)));
  const candidates = scope ? toolsForScope(scope) : [...TOOLS];

  const scores: ToolScore[] = [];
  for (const tool of candidates) {
    let score = 0;
    let earliest = Number.POSITIVE_INFINITY;
    const matched: string[] = [];

    for (const needle of tool.matches) {
      const at = text.indexOf(needle);
      if (at === -1) continue;
      if (needle.includes(' ')) {
        score += 3 + needle.split(' ').length;
      } else {
        score += words.has(needle) ? 3 : 1.5;
      }
      matched.push(needle);
      earliest = Math.min(earliest, at);
    }
    if (score === 0) continue;

    if (Number.isFinite(earliest)) score += 2 * (1 - earliest / text.length);
    scores.push({ tool, score, matched });
  }

  return scores.sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id));
}
