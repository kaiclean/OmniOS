/**
 * Company DNA and brand: values, voice, boundaries, positioning.
 */

import { makeId, type Company } from '@/lib/domain';
import { base, type GenCtx } from './shared';

/* ------------------------------------------------------------------ DNA --- */

const VALUE_POOL = [
  'Evidence before opinion',
  'Ship the smallest honest version',
  'Say the hard thing early',
  'Craft over volume',
  'Leave the system better documented than you found it',
  'No number we cannot defend',
  'Speed, but never at the cost of trust',
  'Own the outcome, not the task',
];

const VOICE_POOL = [
  'Direct',
  'Precise',
  'Warm but unsentimental',
  'Concrete',
  'Confident without hype',
  'Plain-spoken',
  'Technical when it earns its place',
];

const DO_NOT_POOL = [
  'No stock-photo handshakes',
  'No superlatives we cannot evidence',
  'Never claim autonomy the system does not have',
  'No exclamation marks',
  'Never describe a prototype as production',
  'No jargon where a plain word exists',
];

export function makeDna(ctx: GenCtx): Company['dna'] {
  const { rng, draft } = ctx;
  const audienceSeeds = [
    ['Owner-operators', 'Runs the business and the work. Buys time back, not features.'],
    ['Operations leads', 'Judged on throughput and predictability. Hates surprises.'],
    ['Technical founders', 'Will read the docs. Distrusts anything that hides its mechanism.'],
    ['Procurement', 'Needs a defensible reason to sign. Cares about risk, not delight.'],
  ] as const;

  return {
    mission: draft.mission,
    vision: draft.vision,
    purpose: `${draft.name} exists because ${draft.description.replace(/\.$/, '')} — and because doing it well is still rare in ${draft.industry.toLowerCase()}.`,
    values: rng.sample(VALUE_POOL, 4),
    businessModel: draft.businessModel,
    targetAudience: rng.sample([...audienceSeeds], 2).map(([label, description], i) => ({
      id: makeId(label, `${ctx.companyId}:aud:${i}`),
      label,
      description,
      pains: rng.sample(
        [
          'Work that only exists because a system does not',
          'No single place where the real state lives',
          'Decisions made on stale numbers',
          'Quality that depends on one person being available',
          'Cost that is invisible until the quarter closes',
        ],
        2,
      ),
    })),
    competitors: [
      {
        id: makeId('incumbent', `${ctx.companyId}:c1`),
        name: 'The incumbent',
        positioning: 'Trusted, slow, priced on inertia.',
        threat: 'medium' as const,
      },
      {
        id: makeId('cheap alternative', `${ctx.companyId}:c2`),
        name: 'The cheap alternative',
        positioning: 'Wins on price, loses on follow-through.',
        threat: 'low' as const,
      },
      {
        id: makeId('status quo', `${ctx.companyId}:c3`),
        name: 'Doing nothing',
        positioning: 'The real competitor. Free, familiar, and quietly expensive.',
        threat: 'high' as const,
      },
    ],
    longTermStrategy: `Win a narrow beachhead in ${draft.industry.toLowerCase()} on quality and reliability, systematise what works into repeatable operations, then widen the offer without widening the cost base.`,
    moat: 'Accumulated operating knowledge, encoded as process rather than held in one head.',
  };
}

export function makeBrand(ctx: GenCtx): Company['brand'] {
  const { rng, draft } = ctx;
  const hueSeeded = [
    { name: 'Ink', value: '#0E1013', role: 'surface' as const },
    { name: 'Signal', value: '#C7A87A', role: 'primary' as const },
    { name: 'Stone', value: '#8A9099', role: 'secondary' as const },
    { name: 'Accent', value: '#5E8C7E', role: 'accent' as const },
  ];
  return {
    voice: rng.sample(VOICE_POOL, 4),
    tone: `Assured and specific. ${draft.name} sounds like someone who has actually done the work.`,
    palette: hueSeeded,
    typography: 'One grotesque for everything. Weight and size carry hierarchy, not extra families.',
    imagery: 'Real work, real sites, real hands. Available light. No composites.',
    doNot: rng.sample(DO_NOT_POOL, 4),
    taglines: [
      `${draft.name} — ${draft.mission.replace(/\.$/, '').toLowerCase()}.`,
      'Built to be relied on.',
    ],
  };
}
