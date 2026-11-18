/**
 * What every panel renderer shares: the context a panel is drawn against, the
 * prop shapes, and the collection scoping rule.
 *
 * Kept apart from the dispatcher so the renderers can import it without
 * importing `../CapabilityPanels` back (that would be a cycle).
 */

import type { PanelSpec } from '@/lib/capabilities/panels';
import type { ScopeData } from '@/lib/data/schema';
import type { Company, MemoryRecord, PersonalProfile } from '@/lib/domain';

export interface PanelContext {
  readonly spaceKind: 'company' | 'personal';
  readonly capabilityId: string;
  readonly data: ScopeData;
  readonly company?: Company;
  readonly personal?: PersonalProfile;
  readonly sharedMemory?: readonly MemoryRecord[];
  /** Base href of the space, for panel "see all" links. */
  readonly basePath: string;
}

/** Restrict a collection to the capability that owns the panel, when asked to. */
export function scoped<T extends { capabilityId: string }>(
  items: readonly T[],
  spec: PanelSpec,
  ctx: PanelContext,
): T[] {
  const owner = spec.capabilityId ?? ctx.capabilityId;
  const list =
    spec.capabilityFilter === 'all' ? [...items] : items.filter((i) => i.capabilityId === owner);
  return spec.limit ? list.slice(0, spec.limit) : list;
}

export type PanelProps = { title: string; span: PanelSpec['span']; spec: PanelSpec; ctx: PanelContext };
export type SimplePanelProps = { title: string; span: PanelSpec['span']; ctx: PanelContext };
