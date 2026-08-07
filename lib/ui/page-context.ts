/**
 * Where the founder is standing.
 *
 * One derivation, used by the shell (tint), the assistant surface (target and
 * indicator) and the server (framing, tool preference). It exists because two
 * private copies of the same route regex had already drifted apart — one said
 * 'os', the other said 'founder' — and a third copy was inevitable.
 *
 * Pure and client-safe on purpose: no imports beyond nothing, no store, no
 * window. The server re-derives context from the pathname rather than trusting
 * a client-built object, so a crafted payload cannot claim a capability or a
 * page the route does not have.
 */

export const PAGE_KINDS = [
  'home',
  'space-overview',
  'capability',
  'dna',
  'settings',
  'connections',
  'approvals',
  'automations',
  'assistant',
  'brain',
  'intelligence',
  'studio',
  'factory',
  'finance',
  'companies-index',
  'company-new',
  'capability-global',
  'unknown',
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export interface PageContext {
  readonly pathname: string;
  /** 'company:<id>' | 'personal' | 'os' — the room, for tint and labels. */
  readonly spaceKey: string;
  /** Set when the route is a capability page (in a space, or the global view). */
  readonly capabilityId?: string;
  readonly pageKind: PageKind;
}

/** System routes that map 1:1 onto a page kind. */
const SYSTEM_PAGES: Readonly<Record<string, PageKind>> = {
  '/': 'home',
  '/settings': 'settings',
  '/connections': 'connections',
  '/approvals': 'approvals',
  '/automations': 'automations',
  '/assistant': 'assistant',
  '/brain': 'brain',
  '/studio': 'studio',
  '/factory': 'factory',
  '/finance': 'finance',
  '/companies': 'companies-index',
};

export function derivePageContext(pathname: string): PageContext {
  const clean = pathname.split('?')[0]?.split('#')[0] ?? '/';
  const segments = clean.split('/').filter(Boolean);

  const direct = SYSTEM_PAGES[clean];
  if (direct) return { pathname: clean, spaceKey: 'os', pageKind: direct };

  if (segments[0] === 'intelligence') {
    return { pathname: clean, spaceKey: 'os', pageKind: 'intelligence' };
  }

  if (segments[0] === 'capabilities' && segments[1]) {
    return {
      pathname: clean,
      spaceKey: 'os',
      capabilityId: segments[1],
      pageKind: 'capability-global',
    };
  }

  if (segments[0] === 'companies' && segments[1]) {
    if (segments[1] === 'new') return { pathname: clean, spaceKey: 'os', pageKind: 'company-new' };
    const spaceKey = `company:${segments[1]}`;
    if (!segments[2]) return { pathname: clean, spaceKey, pageKind: 'space-overview' };
    if (segments[2] === 'dna') return { pathname: clean, spaceKey, pageKind: 'dna' };
    return { pathname: clean, spaceKey, capabilityId: segments[2], pageKind: 'capability' };
  }

  if (segments[0] === 'life') {
    if (!segments[1]) return { pathname: clean, spaceKey: 'personal', pageKind: 'space-overview' };
    if (segments[1] === 'dna') return { pathname: clean, spaceKey: 'personal', pageKind: 'dna' };
    return {
      pathname: clean,
      spaceKey: 'personal',
      capabilityId: segments[1],
      pageKind: 'capability',
    };
  }

  return { pathname: clean, spaceKey: 'os', pageKind: 'unknown' };
}

/**
 * The assistant target a page implies. Distinct from `spaceKey` because the
 * assistant has no 'os' mode: outside a space the founder is asking about
 * everything they own, which is founder mode.
 */
export function targetKeyForPage(page: PageContext): string {
  if (page.spaceKey === 'os') return 'founder';
  return page.spaceKey;
}

/**
 * The parts of the context indicator, most general first — "Meridian Build /
 * Marketing". Callers resolve display names; this module knows only ids.
 */
export function pageContextLabelParts(
  page: PageContext,
  names: {
    readonly companyNames: Readonly<Record<string, string>>;
    readonly personalName: string;
    readonly capabilityName?: (id: string) => string | undefined;
  },
): string[] {
  const parts: string[] = [];

  if (page.spaceKey.startsWith('company:')) {
    const id = page.spaceKey.slice('company:'.length);
    parts.push(names.companyNames[id] ?? 'Company');
  } else if (page.spaceKey === 'personal') {
    parts.push(names.personalName);
  } else {
    parts.push('OmniOS');
  }

  if (page.capabilityId) {
    parts.push(names.capabilityName?.(page.capabilityId) ?? page.capabilityId);
  } else if (page.pageKind !== 'space-overview' && page.pageKind !== 'home' && page.pageKind !== 'unknown') {
    parts.push(PAGE_KIND_LABELS[page.pageKind]);
  }

  return parts;
}

const PAGE_KIND_LABELS: Record<PageKind, string> = {
  home: 'Home',
  'space-overview': 'Overview',
  capability: 'Capability',
  dna: 'DNA',
  settings: 'Settings',
  connections: 'Connections',
  approvals: 'Approvals',
  automations: 'Automations',
  assistant: 'Assistant',
  brain: 'Brain',
  intelligence: 'Intelligence',
  studio: 'Creative Studio',
  factory: 'Product Factory',
  finance: 'Finance Center',
  'companies-index': 'Companies',
  'company-new': 'New company',
  'capability-global': 'Capability',
  unknown: 'OmniOS',
};

export function pageKindLabel(kind: PageKind): string {
  return PAGE_KIND_LABELS[kind];
}
