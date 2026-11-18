/**
 * Suggestions, starter memory and creative briefs and assets.
 */

import {
  slugify,
  type Automation,
  type Company,
  type CreativeAsset,
  type CreativeBrief,
  type Goal,
  type MemoryRecord,
  type Suggestion,
} from '@/lib/domain';
import { specialistsForCapability } from '@/lib/ai/specialists';
import { round, series } from '../rng';
import { base, type GenCtx } from './shared';

/* ----------------------------------------------------------- suggestions -- */

export function makeSuggestions(ctx: GenCtx): Suggestion[] {
  const { rng, draft } = ctx;
  const seeds: ReadonlyArray<[string, string, string, Suggestion['impact'], Suggestion['effort'], string[]]> = [
    [
      'Put a price on the site',
      'Unpriced offers filter out exactly the buyers who are ready. A visible starting price removes a whole round of qualification.',
      'sales',
      'high',
      'low',
      ['Pipeline shows 4 leads stalled before a quote', 'Qualification checklist requires a named budget'],
    ],
    [
      'Hand over one delivery completely',
      'The founder appears in every delivery record. One clean handover proves the SOP and buys back the week.',
      'operations',
      'high',
      'medium',
      ['Bottleneck: founder in every delivery', 'Delivery SOP (v1) exists but is untested by anyone else'],
    ],
    [
      'Arm the month-end close pack',
      'It is drafted and would return roughly two hours a month. It only touches internal data.',
      'automation',
      'medium',
      'low',
      ['Automation "Month-end close pack" is in draft', 'Estimated 120 minutes saved per run'],
    ],
    [
      'Pick the beachhead and say no to the rest',
      `${draft.name} is aimed at two audiences at once, which halves the strength of every message.`,
      'strategy',
      'high',
      'medium',
      ['Company DNA names 2 target segments', 'Goal "Decide the first beachhead segment" is still active'],
    ],
    [
      'Write down three pieces of proof-of-work',
      'Evidence converts better than claims, and it is the cheapest content this company can make.',
      'marketing',
      'medium',
      'medium',
      ['No published proof-of-work content yet', 'Brand guidelines forbid unevidenced claims'],
    ],
  ];
  return seeds.map(([title, rationale, capabilityId, impact, effort, evidence], i) => {
    const specialists = specialistsForCapability(capabilityId);
    const specialist = specialists[0]?.id ?? 'chief-of-staff';
    return {
      ...base(ctx, 'sug', `${i}:${title}`),
      title,
      rationale,
      capabilityId,
      specialistId: specialist,
      impact,
      effort,
      confidence: round(rng.float(0.55, 0.92), 2),
      status: 'open' as const,
      evidence,
      simulated: true,
    };
  });
}

/* ---------------------------------------------------------------- memory -- */

export function makeMemory(ctx: GenCtx): MemoryRecord[] {
  const { draft } = ctx;
  const seeds: ReadonlyArray<[MemoryRecord['kind'], string, string]> = [
    ['fact', `${draft.name} operates in ${draft.industry}.`, 'strategy'],
    ['fact', `Business model: ${draft.businessModel}`, 'finance'],
    ['decision', 'Capabilities are granted to this company by default; none were disabled at creation.', 'executive'],
    ['preference', 'Prefers evidence and specifics over narrative in every report.', 'executive'],
    ['pattern', 'Work is defined in two-week slices; anything longer gets broken down.', 'operations'],
    ['lesson', 'Unpriced offers stall in the pipeline before they reach a quote.', 'sales'],
  ];
  return seeds.map(([kind, text, capabilityId], i) => ({
    ...base(ctx, 'mem', `${i}:${text}`),
    kind,
    text,
    capabilityId,
    strength: kind === 'fact' ? 0.9 : 0.6,
    tags: [capabilityId],
    source: 'assistant' as const,
    useCount: 0,
  }));
}

/* -------------------------------------------------------------- creative -- */

export function makeCreative(ctx: GenCtx): { briefs: CreativeBrief[]; assets: CreativeAsset[] } {
  const { draft } = ctx;
  const briefs: CreativeBrief[] = [
    {
      ...base(ctx, 'brief', 'launch'),
      title: 'Launch announcement',
      objective: `Introduce ${draft.name} to the beachhead segment with evidence, not adjectives.`,
      audience: 'Owner-operators and operations leads in the target region.',
      keyMessage: draft.mission,
      mustInclude: ['A real piece of finished work', 'A named starting price', 'One way to start a conversation'],
      mustAvoid: ['Superlatives', 'Stock imagery', 'Claims we cannot show'],
      formats: ['social-post', 'marketing-asset', 'image'],
      channel: 'LinkedIn + site',
    },
    {
      ...base(ctx, 'brief', 'proof'),
      title: 'Proof-of-work series',
      objective: 'Show the work in enough detail that a sceptical buyer can judge quality.',
      audience: 'Technical and procurement buyers who distrust marketing.',
      keyMessage: 'Here is exactly what we did, how, and what it cost.',
      mustInclude: ['Before and after', 'Method', 'What went wrong and how it was handled'],
      mustAvoid: ['Hiding the difficult parts'],
      formats: ['image', 'social-post', 'presentation'],
      channel: 'Site + newsletter',
    },
  ];

  const assetSeeds: ReadonlyArray<[string, CreativeAsset['kind'], CreativeAsset['aspect'], CreativeAsset['status']]> = [
    ['Primary wordmark', 'logo', '1:1', 'draft'],
    ['Launch hero image', 'image', '16:9', 'brief'],
    ['Proof-of-work carousel', 'social-post', '4:5', 'brief'],
    ['Capabilities one-pager', 'presentation', '16:9', 'draft'],
    ['Site hero composition', 'ui-design', '16:9', 'brief'],
  ];

  const assets: CreativeAsset[] = assetSeeds.map(([title, kind, aspect, status], i) => ({
    ...base(ctx, 'asset', `${i}:${title}`),
    title,
    kind,
    status,
    briefId: briefs[i % briefs.length]?.id,
    prompt: `${title} for ${draft.name}. Voice: ${draft.name} sounds assured and specific. No stock imagery.`,
    previewSeed: `${ctx.companyId}:${slugify(title)}`,
    aspect,
    generatedBy: 'designer',
    simulated: true,
  }));

  return { briefs, assets };
}
