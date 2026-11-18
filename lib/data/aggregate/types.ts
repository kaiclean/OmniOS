/**
 * The shape of one space as the founder-level reports see it.
 */

import type { Scope } from '@/lib/domain';
import type { ScopeData } from '../schema';

export interface SpaceView {
  readonly scope: Scope;
  readonly scopeKey: string;
  readonly id: string;
  readonly label: string;
  readonly kind: 'company' | 'personal';
  readonly href: string;
  readonly data: ScopeData;
}

/** Every space the founder owns, in rail order: companies first, then their life. */
