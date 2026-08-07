/**
 * Permission grants — approval recorded in advance, narrowly, revocably.
 *
 * Invariant 2 says a gated call may not run without a recorded human decision.
 * Until now that decision was always per call. A grant is the same decision
 * made once, in advance, for a tightly named slice of the world: one tool (or
 * all tools) on one connection, in one space (or any), optionally until a
 * moment in time. The founder who writes "GitHub push, in Meridian only, for a
 * week" has decided — and the record of that decision is the grant itself,
 * which every call it covers carries by id.
 *
 * Three lines that may never soften, and are pinned by tests:
 *
 * - A grant can cover only tools that arrive through a connection (`mcp:*`).
 *   Built-in `destructive` tools — deleting records, resetting capabilities —
 *   are per-call decisions forever; there is no way to express them here.
 * - A grant loosens nothing by existing. It is consulted only at the moment a
 *   call would otherwise queue, and only an exact match applies.
 * - Revocation is immediate and final for that grant. Calls made under it stay
 *   in the record, naming it.
 */

import type { Timestamp } from './work';

export interface PermissionGrant {
  readonly id: string;
  /** The connection this grant is scoped to. Never '*': trust is per server. */
  readonly serverId: string;
  /** A single tool name, or '*' for every tool the server advertises. */
  readonly toolName: string;
  /** 'company:<id>' | 'personal' | '*' — where calls under this grant may land. */
  readonly scopeKey: string;
  /** Why the founder granted this — shown wherever the grant appears. */
  readonly note: string;
  readonly createdAt: Timestamp;
  /** Absent = until revoked. */
  readonly expiresAt?: Timestamp;
  readonly revokedAt?: Timestamp;
}

export function grantActive(grant: PermissionGrant, now: Date): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && grant.expiresAt <= now.toISOString()) return false;
  return true;
}

/**
 * Whether a grant covers one specific call. Exact by construction: the server
 * must match, the tool must match (or be the explicit wildcard the founder
 * chose), and the scope must match (or be the explicit wildcard). Nothing is
 * inferred, nothing is fuzzy — a permission system with clever matching is a
 * permission system nobody can predict.
 */
export function grantCovers(
  grant: PermissionGrant,
  call: { readonly serverId: string; readonly toolName: string; readonly scopeKey: string },
  now: Date,
): boolean {
  if (!grantActive(grant, now)) return false;
  if (grant.serverId !== call.serverId) return false;
  if (grant.toolName !== '*' && grant.toolName !== call.toolName) return false;
  if (grant.scopeKey !== '*' && grant.scopeKey !== call.scopeKey) return false;
  return true;
}

export const GRANT_DURATIONS = [
  { id: 'hour', label: 'One hour', hours: 1 },
  { id: 'day', label: 'One day', hours: 24 },
  { id: 'week', label: 'One week', hours: 24 * 7 },
  { id: 'until-revoked', label: 'Until I revoke it', hours: null },
] as const;
export type GrantDurationId = (typeof GRANT_DURATIONS)[number]['id'];
