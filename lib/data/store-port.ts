/**
 * The persistence port.
 *
 * Everything above this line is storage-agnostic. Swapping the filesystem for
 * Postgres, Supabase or SQLite means writing one object that satisfies this
 * interface and changing the single line in `store.ts` that picks an adapter —
 * no page, component, action or agent changes.
 */

import type { ScopeData, WorkspaceRoot } from './schema';
import type { Scope } from '@/lib/domain';

export interface WorkspaceStore {
  readonly id: string;
  readonly label: string;

  /** `null` when the workspace has never been initialised. */
  readRoot(): Promise<WorkspaceRoot | null>;
  writeRoot(root: WorkspaceRoot): Promise<void>;

  /** `null` when the scope has no data yet — callers treat that as empty. */
  readScope(scope: Scope): Promise<ScopeData | null>;
  writeScope(scope: Scope, data: ScopeData): Promise<void>;
  dropScope(scope: Scope): Promise<void>;

  /** Wipes the whole workspace. Only reachable from Settings, behind a confirmation. */
  reset(): Promise<void>;

  /** Shown in Settings so a founder always knows where their data physically is. */
  describeLocation(): string;
}
