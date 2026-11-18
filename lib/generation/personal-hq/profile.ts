/**
 * The personal profile: personal DNA, values and boundaries.
 */

import type { PersonalProfile } from '@/lib/domain';
import { iso } from './shared';

/* -------------------------------------------------------------- profile --- */

export function makePersonalProfile(displayName: string, now: Date): PersonalProfile {
  return {
    id: 'personal',
    displayName,
    timezone: 'Europe/Zurich',
    baseCurrency: 'CHF',
    createdAt: iso(now),
    updatedAt: iso(now),
    dna: {
      identity:
        'A builder who thinks in systems. Happiest turning an ambiguous idea into something that runs, and unhappy when the work outruns the body carrying it.',
      values: [
        'Truth over comfort',
        'Build it, then prove it works',
        'Health is infrastructure, not a reward',
        'Depth over breadth',
        'Keep promises small enough to keep',
      ],
      lifeGoals: [
        'Run companies that do not require me to be present to survive',
        'Stay strong and clear-headed into my sixties',
        'Keep the people close who were there before any of this',
        'Learn something structurally new every year',
      ],
      longTermVision:
        'One system that carries the operational weight of several companies and a full life, so the remaining human hours go to judgement, craft and people.',
      healthPhilosophy:
        'Sleep first, then movement, then everything else. Recovery is measured, not guessed. A bad week is data, not a verdict.',
      financialGoals: [
        'Twelve months of personal runway held separately from any company',
        'Fixed costs covered by recurring income',
        'No debt that funds operations',
      ],
      lifestylePreferences: [
        'Deep work in the morning, meetings after 14:00',
        'One full day a week with no screens',
        'Travel that has a reason, not a schedule',
      ],
      nonNegotiables: [
        'Seven hours of sleep on working nights',
        'Family time is not moveable for work',
        'No commitment made while tired',
      ],
    },
    personalBrand: {
      voice: ['Direct', 'Specific', 'Unhurried', 'Evidence-first'],
      tone: 'Someone who has built the thing they are talking about.',
      palette: [
        { name: 'Ground', value: '#0B0B0C', role: 'surface' },
        { name: 'Bone', value: '#EDEBE7', role: 'primary' },
        { name: 'Ash', value: '#8B8D93', role: 'secondary' },
        { name: 'Ember', value: '#C08A5A', role: 'accent' },
      ],
      typography: 'One grotesque, tight tracking, generous line height.',
      imagery: 'Workshops, screens, mountains. Nothing staged.',
      doNot: ['No hustle language', 'No claims about outcomes not yet reached', 'Never perform certainty'],
      taglines: ['Systems, not shortcuts.'],
    },
    disabledCapabilityIds: [],
  };
}
