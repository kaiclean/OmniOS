import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  capabilitiesFor,
  capabilityIds,
  capabilityLabel,
  getCapability,
  primaryNavCapabilities,
} from '@/lib/capabilities/registry';
import { PANEL_KINDS, panelTitle } from '@/lib/capabilities/panels';
import { ICON_NAMES, isIconName } from '@/components/ui/Icon';
import { hueForCompany, hueForSpaceKey, OS_HUE, PERSONAL_HUE } from '@/lib/ui/space-tint';

describe('capability registry', () => {
  it('has unique ids', () => {
    const ids = capabilityIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only uses panel kinds the renderer knows', () => {
    for (const capability of CAPABILITIES) {
      for (const spec of [...capability.panels, ...(capability.overviewPanels ?? [])]) {
        expect(PANEL_KINDS, `${capability.id} uses unknown panel "${spec.kind}"`).toContain(spec.kind);
      }
    }
  });

  it('only names icons that exist', () => {
    for (const capability of CAPABILITIES) {
      expect(isIconName(capability.icon), `${capability.id} names missing icon "${capability.icon}"`).toBe(true);
    }
    expect(ICON_NAMES.length).toBeGreaterThan(20);
  });

  it('gives every capability at least one panel', () => {
    for (const capability of CAPABILITIES) {
      expect(capability.panels.length, `${capability.id} has no panels`).toBeGreaterThan(0);
    }
  });

  it('uses spans that fit the twelve-column grid', () => {
    for (const capability of CAPABILITIES) {
      for (const spec of [...capability.panels, ...(capability.overviewPanels ?? [])]) {
        expect([4, 6, 8, 12]).toContain(spec.span);
      }
    }
  });

  it('applies every capability to at least one space kind', () => {
    for (const capability of CAPABILITIES) {
      expect(capability.appliesTo.length).toBeGreaterThan(0);
    }
  });

  it('gives a company a substantial headquarters out of the box', () => {
    expect(capabilitiesFor('company').length).toBeGreaterThanOrEqual(12);
  });

  it('gives personal life its own life-specific capabilities', () => {
    const personal = capabilitiesFor('personal').map((c) => c.id);
    for (const id of ['health', 'relationships', 'learning', 'life-ops']) {
      expect(personal).toContain(id);
    }
  });

  it('does not offer company-only capabilities to a life', () => {
    expect(capabilitiesFor('personal').map((c) => c.id)).not.toContain('hr');
  });

  it('honours disabled capabilities', () => {
    const withoutLegal = capabilitiesFor('company', ['legal']).map((c) => c.id);
    expect(withoutLegal).not.toContain('legal');
    expect(capabilitiesFor('company').map((c) => c.id)).toContain('legal');
  });

  it('returns capabilities in a stable order', () => {
    const orders = capabilitiesFor('company').map((c) => c.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('uses the personal label only in personal life', () => {
    const marketing = getCapability('marketing');
    expect(marketing).toBeDefined();
    if (!marketing) return;
    expect(capabilityLabel(marketing, 'company')).toBe('Marketing');
    expect(capabilityLabel(marketing, 'personal')).toBe('Personal brand');
  });

  it('pins a small set to the primary rail', () => {
    const pinned = primaryNavCapabilities();
    expect(pinned.length).toBeGreaterThan(2);
    expect(pinned.length).toBeLessThan(9);
  });

  it('returns undefined for an unknown id rather than throwing', () => {
    expect(getCapability('does-not-exist')).toBeUndefined();
  });
});

describe('panel titles', () => {
  it('prefers the personal wording in a life, when one is given', () => {
    const spec = { kind: 'tasks' as const, title: 'Company work', titlePersonal: 'Your work', span: 6 as const };
    expect(panelTitle(spec, 'company')).toBe('Company work');
    expect(panelTitle(spec, 'personal')).toBe('Your work');
  });

  it('falls back to the shared title when no personal wording exists', () => {
    const spec = { kind: 'tasks' as const, title: 'Work', span: 6 as const };
    expect(panelTitle(spec, 'personal')).toBe('Work');
  });
});

describe('space tint', () => {
  it('is stable for the same space', () => {
    expect(hueForCompany('meridian-build-x1')).toBe(hueForCompany('meridian-build-x1'));
  });

  it('gives different companies different hues', () => {
    const hues = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(hueForCompany);
    expect(new Set(hues).size).toBeGreaterThan(3);
  });

  it('keeps personal life on its own fixed warm hue', () => {
    expect(hueForSpaceKey('personal')).toBe(PERSONAL_HUE);
  });

  it('uses the OS hue at root level', () => {
    expect(hueForSpaceKey('os')).toBe(OS_HUE);
    expect(hueForSpaceKey('')).toBe(OS_HUE);
  });

  it('never lands a company on a semantic alarm hue', () => {
    const reserved: ReadonlyArray<readonly [number, number]> = [
      [12, 40],
      [62, 92],
      [140, 168],
    ];
    for (let i = 0; i < 400; i += 1) {
      const hue = hueForCompany(`company-${i}`);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      for (const [lo, hi] of reserved) {
        expect(hue < lo || hue > hi, `company-${i} landed on reserved hue ${hue}`).toBe(true);
      }
    }
  });
});
