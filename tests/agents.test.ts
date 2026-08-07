import { describe, expect, it } from 'vitest';

import { AGENT_PRESETS } from '@/lib/ai/agent-presets';
import { recommendParticipants } from '@/lib/ai/meeting';
import { route } from '@/lib/ai/router';
import { SPECIALISTS, getSpecialist } from '@/lib/ai/specialists';
import { getTool } from '@/lib/ai/tools';
import { capabilityIds } from '@/lib/capabilities/registry';
import type { CustomAgent } from '@/lib/domain';
import { SPECIALIST_DOMAINS, agentIdFrom, companyScope, mergeRoster } from '@/lib/domain';

const scope = companyScope('acme');

function agent(patch: Partial<CustomAgent>): CustomAgent {
  return {
    id: 'sponsorship-scout',
    scope,
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
    name: 'Sponsorship Scout',
    domain: 'marketing',
    role: 'Brand partnerships',
    charter: 'Finds sponsors whose audience already overlaps ours.',
    capabilityIds: ['marketing'],
    matches: ['sponsor', 'sponsorship', 'brand deal'],
    toolIds: [],
    allowedScopeKinds: ['company'],
    wouldDo: [],
    overridesBuiltIn: false,
    enabled: true,
    createdBy: 'founder',
    ...patch,
  };
}

describe('the roster', () => {
  it('appends an enabled hire and omits a disabled one', () => {
    const withHire = mergeRoster(SPECIALISTS, [agent({})]);
    expect(withHire.some((s) => s.id === 'sponsorship-scout')).toBe(true);
    expect(withHire.length).toBe(SPECIALISTS.length + 1);

    const withoutHire = mergeRoster(SPECIALISTS, [agent({ enabled: false })]);
    expect(withoutHire.some((s) => s.id === 'sponsorship-scout')).toBe(false);
  });

  it('lets an enabled override replace a built-in, and a disabled one hide it', () => {
    const replaced = mergeRoster(SPECIALISTS, [
      agent({ id: 'engineer', name: 'Staff Engineer', overridesBuiltIn: true }),
    ]);
    const engineer = replaced.find((s) => s.id === 'engineer');
    expect(engineer?.name).toBe('Staff Engineer');
    expect(replaced.length).toBe(SPECIALISTS.length);

    const hidden = mergeRoster(SPECIALISTS, [
      agent({ id: 'engineer', overridesBuiltIn: true, enabled: false }),
    ]);
    expect(hidden.some((s) => s.id === 'engineer')).toBe(false);
    // The built-in itself is untouched — deleting the override restores it.
    expect(getSpecialist('engineer')).toBeDefined();
  });

  it('routes to a hired agent on its own phrases, only where it lives', () => {
    const roster = mergeRoster(SPECIALISTS, [agent({})]);
    const inCompany = route('find us a sponsorship for the launch', ['company'], [], roster);
    expect(inCompany.lead.id).toBe('sponsorship-scout');
    // The same roster asked from a personal-only angle never reaches it.
    const inLife = route('find us a sponsorship for the launch', ['personal'], [], roster);
    expect(inLife.lead.id).not.toBe('sponsorship-scout');
  });

  it('seats a hired agent in the meeting room for its topic', () => {
    const roster = mergeRoster(SPECIALISTS, [agent({})]);
    const seated = recommendParticipants('which sponsor should we sign?', 'company', roster);
    expect(seated.some((s) => s.id === 'sponsorship-scout')).toBe(true);
    expect(seated.some((s) => s.id === 'chief-of-staff')).toBe(true);
  });

  it('keeps every preset honest: real capabilities, real tools, valid domains', () => {
    const validCapabilities = new Set(capabilityIds());
    const validDomains = new Set<string>(SPECIALIST_DOMAINS);
    for (const preset of AGENT_PRESETS) {
      expect(validDomains.has(preset.domain)).toBe(true);
      expect(preset.capabilityIds.length).toBeGreaterThan(0);
      for (const capability of preset.capabilityIds) {
        expect(validCapabilities.has(capability)).toBe(true);
      }
      for (const toolId of preset.toolIds) {
        expect(getTool(toolId), `preset ${preset.id} names unknown tool ${toolId}`).toBeDefined();
      }
      expect(preset.matches.length).toBeGreaterThan(2);
      expect(preset.allowedScopeKinds.length).toBeGreaterThan(0);
      // A preset must not silently shadow a built-in when hired under its own name.
      expect(getSpecialist(agentIdFrom(preset.name))).toBeUndefined();
    }
  });
});
