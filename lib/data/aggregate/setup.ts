/**
 * Zero to hero, derived from the workspace. Part of the cross-space quarantine: nothing
 * under `lib/ai/` may import this (see `tests/boundaries.test.ts`).
 */

import type { WorkspaceRoot } from '../schema';
import type { SpaceView } from './types';

/* ------------------------------------------------------ setup progress ---- */

export interface SetupStep {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly done: boolean;
  readonly href: string;
}

export interface SetupProgress {
  readonly steps: readonly SetupStep[];
  readonly done: number;
  readonly total: number;
  readonly complete: boolean;
}

/**
 * Zero to hero, derived — never stored, so it can neither nag about something
 * already done nor congratulate something undone. Each step is a real state of
 * the workspace, checked from the records themselves.
 */
export function setupProgress(
  spaces: readonly SpaceView[],
  workspace: Pick<WorkspaceRoot, 'companies' | 'telegram' | 'mcpStates' | 'grants'>,
  flags: { readonly hasRealProvider: boolean },
): SetupProgress {
  const firstCompany = workspace.companies.find((company) => !company.archivedAt);
  const roomHref = firstCompany ? `/companies/${firstCompany.id}/room` : '/life/room';
  const teamHref = firstCompany ? `/companies/${firstCompany.id}/team` : '/life/team';

  const steps: SetupStep[] = [
    {
      id: 'brain',
      label: 'Give it a brain',
      detail: 'Put a model key in the vault so the assistant thinks with a real model, not the local simulator.',
      done: flags.hasRealProvider,
      href: '/connections',
    },
    {
      id: 'company',
      label: 'Create your first company',
      detail: 'A space of your own, beyond the sample workspaces.',
      done: workspace.companies.some((company) => !company.generated && !company.archivedAt),
      href: '/companies/new',
    },
    {
      id: 'meeting',
      label: 'Hold a meeting',
      detail: 'Put a real question to the room and watch the specialists argue from your records.',
      done: spaces.some((space) => space.data.meetings.length > 0),
      href: roomHref,
    },
    {
      id: 'decision',
      label: 'Decide something at the gate',
      detail: 'Approve or reject a queued call. The gate is the product — feel it hold.',
      done: spaces.some((space) => space.data.toolCalls.some((call) => call.decidedBy !== undefined)),
      href: '/approvals',
    },
    {
      id: 'agent',
      label: 'Hire an agent',
      detail: 'Grow one space’s roster with a preset or an agent you invent.',
      // Switching a built-in off also writes a customAgents record; that is
      // not a hire, and this meter must never congratulate something undone.
      done: spaces.some((space) => space.data.customAgents.some((agent) => !agent.offSwitch)),
      href: teamHref,
    },
    {
      id: 'telegram',
      label: 'Approve from your phone',
      detail: 'Connect Telegram so gated calls reach you wherever you are.',
      done: workspace.telegram.enabled,
      href: '/connections',
    },
    {
      id: 'connection',
      label: 'Reach outside',
      detail: 'Connect an MCP server and the assistant gains its tools — behind the same gate.',
      done: workspace.mcpStates.some((state) => state.status === 'connected'),
      href: '/connections',
    },
    {
      id: 'grant',
      label: 'Record trust in advance',
      detail: 'Give one recurring external call a standing grant — narrow, expiring, revocable.',
      done: workspace.grants.length > 0,
      href: '/approvals',
    },
  ];

  const done = steps.filter((step) => step.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length };
}
