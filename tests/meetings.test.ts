import { describe, expect, it } from 'vitest';

import { newMeeting, recommendParticipants } from '@/lib/ai/meeting';
import { getSpecialist } from '@/lib/ai/specialists';
import { getTool } from '@/lib/ai/tools';
import { personalScope, validateArgs } from '@/lib/domain';

describe('the meeting room', () => {
  it('invites the right specialists for the topic, capped and chaired', () => {
    const forDelivery = recommendParticipants('why is delivery slipping and how do we ship faster', 'company');
    expect(forDelivery.length).toBeGreaterThanOrEqual(2);
    expect(forDelivery.length).toBeLessThanOrEqual(5);
    // The chief of staff chairs every room so sequencing always has a voice.
    expect(forDelivery.some((s) => s.id === 'chief-of-staff')).toBe(true);
    for (const s of forDelivery) expect(getSpecialist(s.id)).toBeDefined();
  });

  it('never seats a company-only specialist in a personal council', () => {
    for (const s of recommendParticipants('sales pipeline and revenue', 'personal')) {
      expect(s.allowedScopeKinds).toContain('personal');
    }
  });

  it('is deterministic: same topic, same room', () => {
    const a = recommendParticipants('marketing launch plan', 'company').map((s) => s.id);
    const b = recommendParticipants('marketing launch plan', 'company').map((s) => s.id);
    expect(b).toEqual(a);
  });

  it('opens in session with a stable id from topic and time', () => {
    const now = new Date('2026-08-07T12:00:00.000Z');
    const first = newMeeting(personalScope(), 'topic', ['chief-of-staff'], now);
    const second = newMeeting(personalScope(), 'topic', ['chief-of-staff'], now);
    expect(first.id).toBe(second.id);
    expect(first.stage).toBe('in-session');
    expect(first.turns).toEqual([]);
  });

  it('approval-shaped plan tasks validate against the real create_task tool', () => {
    // The approval path feeds plan tasks into create_task; a plan task shape
    // that create_task would reject is a plan that silently creates nothing.
    const tool = getTool('create_task')!;
    const validation = validateArgs(tool, {
      title: 'Write the delivery SOP',
      capabilityId: 'operations',
      status: 'next',
      notes: 'From the meeting "x" — owner: chief-of-staff.',
    });
    expect(validation.ok).toBe(true);
  });
});
