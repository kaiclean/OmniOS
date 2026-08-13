'use server';

import { revalidatePath } from 'next/cache';

import type { GrantDurationId, PermissionGrant, Scope, ToolOutcome } from '@/lib/domain';
import { GRANT_DURATIONS, grantActive, makeRecordId, parseMcpToolId, scopeKey } from '@/lib/domain';
import { getWorkspace, readCollection, saveWorkspace } from '@/lib/data/store';
import { approveToolCall } from './tools';

/**
 * Standing grants — created, listed, revoked.
 *
 * Creation happens from a pending approval, never from a blank form: the
 * founder grants exactly the (server, tool, scope) triple of a call they are
 * looking at, with its preview in front of them. That keeps every grant
 * anchored to a concrete example of what it permits, and makes "Always allow"
 * a one-click stronger form of "Approve" rather than a separate permission
 * editor nobody can audit.
 */

function expiryFor(duration: GrantDurationId, now: Date): string | undefined {
  const entry = GRANT_DURATIONS.find((candidate) => candidate.id === duration);
  if (!entry || entry.hours === null) return undefined;
  return new Date(now.getTime() + entry.hours * 3_600_000).toISOString();
}

/**
 * Approve a waiting call and record a grant covering its exact shape, so the
 * next identical-shaped call runs without asking. Refuses anything that is not
 * a connection tool — built-in destructive calls cannot be granted, ever.
 */
export async function approveAndAlwaysAllow(
  scope: Scope,
  toolCallId: string,
  duration: GrantDurationId,
): Promise<ToolOutcome> {
  const calls = await readCollection(scope, 'toolCalls');
  const call = calls.find((candidate) => candidate.id === toolCallId);
  if (!call) return { ok: false, summary: 'That call is not in this space.', error: 'not-found' };

  const remote = parseMcpToolId(call.toolId);
  if (!remote) {
    return {
      ok: false,
      summary:
        'Only connection tools can be granted standing approval. Deleting or resetting inside OmniOS is decided per call, always.',
      error: 'not-grantable',
    };
  }

  // Approve first. A grant is a standing authorisation, and minting one for a
  // call that turns out to be already-decided (double-click, or rejected in
  // another tab) leaves a live grant behind a decision that never happened.
  // Approving through the existing action keeps the per-call decision recorded
  // exactly as before; the grant only covers the calls that come after.
  const outcome = await approveToolCall(scope, toolCallId);
  if (!outcome.ok) {
    revalidatePath('/', 'layout');
    return outcome;
  }

  const now = new Date();
  const grant: PermissionGrant = {
    id: makeRecordId('grant', `${remote.serverId}:${remote.toolName}:${scopeKey(scope)}:${now.toISOString()}`),
    serverId: remote.serverId,
    toolName: remote.toolName,
    scopeKey: scopeKey(scope),
    note: `Always allow “${remote.toolName}” on ${remote.serverId} in this space`,
    createdAt: now.toISOString(),
    ...(expiryFor(duration, now) ? { expiresAt: expiryFor(duration, now)! } : {}),
  };

  await saveWorkspace((current) => ({ ...current, grants: [...current.grants, grant] }));
  revalidatePath('/', 'layout');
  return outcome;
}

export async function revokeGrant(grantId: string): Promise<void> {
  const now = new Date().toISOString();
  await saveWorkspace((current) => ({
    ...current,
    // Revoked, never deleted: calls that ran under it point at it by id, and an
    // audit trail with missing referents is not an audit trail.
    grants: current.grants.map((grant) =>
      grant.id === grantId && !grant.revokedAt ? { ...grant, revokedAt: now } : grant,
    ),
  }));
  revalidatePath('/', 'layout');
}

export interface GrantView {
  readonly grant: PermissionGrant;
  readonly active: boolean;
  readonly serverName: string;
  readonly spaceLabel: string;
}

export async function listGrants(): Promise<GrantView[]> {
  const workspace = await getWorkspace();
  const now = new Date();
  return workspace.grants
    .map((grant) => ({
      grant,
      active: grantActive(grant, now),
      serverName:
        workspace.mcpServers.find((server) => server.id === grant.serverId)?.name ?? grant.serverId,
      spaceLabel:
        grant.scopeKey === '*'
          ? 'Every space'
          : grant.scopeKey === 'personal'
            ? workspace.personal.displayName
            : (workspace.companies.find((company) => `company:${company.id}` === grant.scopeKey)?.name ??
              grant.scopeKey),
    }))
    .sort((a, b) => (a.grant.createdAt < b.grant.createdAt ? 1 : -1));
}
