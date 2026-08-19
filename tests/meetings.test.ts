import { describe, expect, it } from 'vitest';

import { newMeeting, recommendParticipants } from '@/lib/ai/meeting';
import { SPECIALISTS, getSpecialist } from '@/lib/ai/specialists';
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

/**
 * A room with one person in it is not a room.
 *
 * `recommendParticipants` seats whoever the topic names and falls back to the
 * chief of staff alone when nothing matches. That fallback is correct — better
 * one honest chair than five specialists guessing — but it fired on ordinary
 * founder vocabulary: "quoting" (because `sales` declared `quote`, and
 * `includes` is a substring test, not a stem) and "hiring" (which no specialist
 * in the roster declared at all, despite `operator` owning the hr capability).
 *
 * The fix is data, per CLAUDE.md: a specialist is a registry entry, not a branch.
 * This test is the thing that notices when the vocabulary drifts behind the
 * words founders actually use.
 */
describe('the room seats more than the chair for ordinary topics', () => {
  it.each([
    ['Our quoting is manual and inconsistent. What should we change first?', 'sales'],
    ['Why are we behind on delivery, and how do we ship twice as fast?', 'project-manager'],
    ['Should we raise prices next quarter?', 'cfo'],
    ['Our marketing is not generating leads', 'marketer'],
    ['How do we reduce costs and extend runway?', 'cfo'],
    ['what should we do about hiring', 'operator'],
  ])('seats %s alongside the chair', (topic, expected) => {
    const seated = recommendParticipants(topic, 'company', SPECIALISTS).map((s) => s.id);
    expect(seated, topic).toContain('chief-of-staff');
    expect(seated, topic).toContain(expected);
    expect(seated.length, `${topic} seated only the fallback`).toBeGreaterThan(1);
    expect(seated.length).toBeLessThanOrEqual(5);
  });
});
