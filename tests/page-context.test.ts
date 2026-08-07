import { describe, expect, it } from 'vitest';

import {
  PAGE_KINDS,
  derivePageContext,
  pageContextLabelParts,
  pageKindLabel,
  targetKeyForPage,
} from '@/lib/ui/page-context';

describe('deriving where the founder is standing', () => {
  it('reads a company capability page completely', () => {
    const page = derivePageContext('/companies/meridian-build-b3o5/marketing');
    expect(page.spaceKey).toBe('company:meridian-build-b3o5');
    expect(page.capabilityId).toBe('marketing');
    expect(page.pageKind).toBe('capability');
    expect(targetKeyForPage(page)).toBe('company:meridian-build-b3o5');
  });

  it('never mistakes the create-company form for a company', () => {
    const page = derivePageContext('/companies/new');
    expect(page.pageKind).toBe('company-new');
    expect(page.spaceKey).toBe('os');
    expect(targetKeyForPage(page)).toBe('founder');
  });

  it('reads personal life pages', () => {
    expect(derivePageContext('/life').pageKind).toBe('space-overview');
    expect(derivePageContext('/life').spaceKey).toBe('personal');
    expect(derivePageContext('/life/health').capabilityId).toBe('health');
    expect(derivePageContext('/life/dna').pageKind).toBe('dna');
    expect(targetKeyForPage(derivePageContext('/life/health'))).toBe('personal');
  });

  it('maps every system page to its kind, and system pages to founder mode', () => {
    for (const [path, kind] of [
      ['/', 'home'],
      ['/settings', 'settings'],
      ['/connections', 'connections'],
      ['/approvals', 'approvals'],
      ['/brain', 'brain'],
      ['/intelligence/upgrades', 'intelligence'],
      ['/companies', 'companies-index'],
    ] as const) {
      const page = derivePageContext(path);
      expect(page.pageKind, path).toBe(kind);
      expect(targetKeyForPage(page), path).toBe('founder');
    }
  });

  it('shrugs at an unknown route rather than throwing', () => {
    const page = derivePageContext('/nothing/here');
    expect(page.pageKind).toBe('unknown');
    expect(page.spaceKey).toBe('os');
  });

  it('ignores query strings and fragments', () => {
    expect(derivePageContext('/life/health?assistant=abc#top').capabilityId).toBe('health');
  });

  it('labels every page kind', () => {
    for (const kind of PAGE_KINDS) expect(pageKindLabel(kind)).toBeTruthy();
  });
});

describe('the context indicator', () => {
  const names = {
    companyNames: { 'meridian-build-b3o5': 'Meridian Build' },
    personalName: 'Kai',
    capabilityName: (id: string) => (id === 'marketing' ? 'Marketing' : undefined),
  };

  it('reads Company / Capability on a capability page', () => {
    expect(
      pageContextLabelParts(derivePageContext('/companies/meridian-build-b3o5/marketing'), names),
    ).toEqual(['Meridian Build', 'Marketing']);
  });

  it('names the system page when outside a space', () => {
    expect(pageContextLabelParts(derivePageContext('/connections'), names)).toEqual([
      'OmniOS',
      'Connections',
    ]);
  });

  it('falls back to the raw id for an unknown capability, never blank', () => {
    expect(
      pageContextLabelParts(derivePageContext('/life/health'), names),
    ).toEqual(['Kai', 'health']);
  });
});
