import 'server-only';

/**
 * The Team page's view of one scope's roster: every seat, its provenance
 * (built-in, customised, hired), whether it is on, and which presets are still
 * available to hire. Pure assembly over one scope — no authority lives here.
 */

import type { Scope } from '@/lib/domain';
import { agentIdFrom } from '@/lib/domain';
import { readCollection } from '@/lib/data/store';
import { AGENT_PRESETS } from './agent-presets';
import { SPECIALISTS } from './specialists';

export interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly charter: string;
  readonly kind: 'built-in' | 'override' | 'custom';
  readonly enabled: boolean;
}

export interface TeamPresetView {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly summary: string;
  readonly group: string;
  readonly hired: boolean;
}

export async function teamViewFor(scope: Scope): Promise<{
  rows: TeamRow[];
  presets: TeamPresetView[];
}> {
  const kind = scope.kind === 'company' ? 'company' : 'personal';
  const stored = scope.kind === 'shared' ? [] : await readCollection(scope, 'customAgents');
  const storedById = new Map(stored.map((agent) => [agent.id, agent]));

  const rows: TeamRow[] = [];
  for (const builtIn of SPECIALISTS) {
    if (!builtIn.allowedScopeKinds.includes(kind)) continue;
    const override = storedById.get(builtIn.id);
    if (!override) {
      rows.push({
        id: builtIn.id,
        name: builtIn.name,
        role: builtIn.role,
        charter: builtIn.charter,
        kind: 'built-in',
        enabled: true,
      });
    } else if (!override.enabled && !override.presetId) {
      // A pure off-switch: show the built-in, off.
      rows.push({
        id: builtIn.id,
        name: builtIn.name,
        role: builtIn.role,
        charter: builtIn.charter,
        kind: 'built-in',
        enabled: false,
      });
    } else {
      rows.push({
        id: override.id,
        name: override.name,
        role: override.role,
        charter: override.charter,
        kind: 'override',
        enabled: override.enabled,
      });
    }
  }

  for (const agent of stored) {
    if (agent.overridesBuiltIn) continue;
    rows.push({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      charter: agent.charter,
      kind: 'custom',
      enabled: agent.enabled,
    });
  }

  const presets: TeamPresetView[] = AGENT_PRESETS.filter((preset) =>
    preset.allowedScopeKinds.includes(kind),
  ).map((preset) => ({
    id: preset.id,
    name: preset.name,
    role: preset.role,
    summary: preset.summary,
    group: preset.group,
    hired: stored.some(
      (agent) => agent.presetId === preset.id || agent.id === agentIdFrom(preset.name),
    ),
  }));

  return { rows, presets };
}
