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
  /**
   * Atomic read-modify-write of the root. The whole `read → transform → write`
   * runs inside the file's write queue, so two concurrent callers cannot both
   * read the same snapshot and have the second silently discard the first —
   * the failure that let a heartbeat resurrect a grant a revoke had just
   * removed. `transform` receives `null` on first run.
   */
  mutateRoot(transform: (current: WorkspaceRoot | null) => WorkspaceRoot): Promise<WorkspaceRoot>;

  /** `null` when the scope has no data yet — callers treat that as empty. */
  readScope(scope: Scope): Promise<ScopeData | null>;
  writeScope(scope: Scope, data: ScopeData): Promise<void>;
  /** Atomic read-modify-write of one scope. Same serialisation guarantee as `mutateRoot`. */
  mutateScope(scope: Scope, transform: (current: ScopeData) => ScopeData): Promise<ScopeData>;
  dropScope(scope: Scope): Promise<void>;

  /** Wipes the whole workspace. Only reachable from Settings, behind a confirmation. */
  reset(): Promise<void>;

  /** Shown in Settings so a founder always knows where their data physically is. */
  describeLocation(): string;
}
