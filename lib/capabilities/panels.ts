/**
 * Panels are the atoms a Capability is assembled from.
 *
 * Every panel kind reads scoped records through the store and knows nothing about
 * *which* space it is rendering. That is the mechanism that lets a single
 * Capability definition serve a company and a personal life without a branch:
 * the panel asks for "tasks in this scope", not "this company's tasks".
 */

export const PANEL_KINDS = [
  'kpi-grid',
  'goals',
  'tasks',
  'roadmap',
  'automations',
  'knowledge',
  'crm',
  'finance-summary',
  'finance-ledger',
  'risks',
  'suggestions',
  'assets',
  'briefs',
  'ai-team',
  'company-dna',
  'brand-dna',
  'expansion',
  'personal-dna',
  'health',
  'habits',
  'relationships',
  'learning',
  'life-admin',
  'calendar',
  'products',
  'memory',
] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** How wide a panel sits in the 12-column HQ grid. */
export type PanelSpan = 4 | 6 | 8 | 12;

export interface PanelSpec {
  readonly kind: PanelKind;
  readonly title: string;
  /** Personal life often wants a warmer word for the same panel. */
  readonly titlePersonal?: string;
  readonly span: PanelSpan;
  readonly limit?: number;
  /** Restrict a panel to records belonging to one capability. */
  readonly capabilityFilter?: 'self' | 'all';
  /**
   * Which capability "self" means for this panel.
   *
   * Normally unset — a panel inherits the capability whose page it is on. It is
   * set when panels from several capabilities are composed onto one screen (a
   * space's Executive Overview), so Marketing's tile keeps showing marketing
   * records rather than inheriting whatever capability owns the page.
   */
  readonly capabilityId?: string;
  readonly emptyHint?: string;
}

/** Bind a spec to the capability that declared it, for cross-capability screens. */
export function ownedBy(spec: PanelSpec, capabilityId: string): PanelSpec {
  return { ...spec, capabilityId };
}

export function panelTitle(spec: PanelSpec, spaceKind: 'company' | 'personal'): string {
  if (spaceKind === 'personal' && spec.titlePersonal) return spec.titlePersonal;
  return spec.title;
}

export const panel = (
  kind: PanelKind,
  title: string,
  span: PanelSpan,
  extra: Omit<PanelSpec, 'kind' | 'title' | 'span'> = {},
): PanelSpec => ({ kind, title, span, capabilityFilter: 'self', ...extra });
