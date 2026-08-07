/**
 * Launch programs — what "manage the business for me" actually decomposes into.
 *
 * A founder asking OmniOS to start and run a company is asking for two very
 * different kinds of work, and the value of this file is that it refuses to blur
 * them:
 *
 * - **Internal steps** are the thinking. Positioning, the offer, the numbers
 *   worth watching, the roadmap, the budget, the risks. These are records in the
 *   founder's own workspace, they execute immediately, and nothing outside this
 *   machine is involved.
 * - **Outward steps** are the doing. Registering a domain, deploying a
 *   storefront, generating ad creative, publishing to an account. Every one of
 *   these needs a connection, every one is `external`, and every one stops for a
 *   decision. When no connection can do it, that is reported as a gap with the
 *   name of what is missing — never quietly skipped, and never faked.
 *
 * The distinction is the honest version of "the agent runs your business". It
 * genuinely does the first half unattended. It prepares the second half, names
 * what it needs, and waits — which is the only version of this that is safe to
 * give real credentials to.
 *
 * Deterministic: the same company and model always produce the same program, so
 * a founder who runs it twice sees the same plan rather than a reshuffle.
 */

import type { ToolArgs } from '@/lib/domain';

export const BUSINESS_MODELS = ['dropshipping', 'agency', 'saas', 'content', 'local-service'] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

export const BUSINESS_MODEL_LABELS: Record<BusinessModel, string> = {
  dropshipping: 'Dropshipping store',
  agency: 'Agency or studio',
  saas: 'Software product',
  content: 'Content and audience',
  'local-service': 'Local service business',
};

export const BUSINESS_MODEL_NOTES: Record<BusinessModel, string> = {
  dropshipping:
    'Margin is thin and traffic is bought, so the programme front-loads unit economics and creative volume.',
  agency: 'Revenue follows a pipeline and a reputation, so the programme front-loads offer and proof.',
  saas: 'The bottleneck is a working slice in front of a real user, not a feature list.',
  content: 'Distribution compounds and nothing else does, so cadence is the first constraint.',
  'local-service': 'Demand is geographic and trust-led; presence and response time carry it.',
};

/** What an outward step needs, expressed so a connection can be matched to it. */
export interface OutwardNeed {
  /** Plain language: what would happen if this ran. */
  readonly intent: string;
  /** Tool-name fragments to look for on a connected server. */
  readonly toolNameHints: readonly string[];
  /** The preset that would supply it, when there is an obvious one. */
  readonly presetId?: string;
  /** The main text this call would carry, mapped onto the tool's own parameter. */
  readonly payload?: string;
}

export interface LaunchStep {
  readonly id: string;
  readonly title: string;
  /** Why this step, in terms a founder would use. Rendered in the plan. */
  readonly why: string;
  readonly capabilityId: string;
  readonly kind: 'internal' | 'outward';
  /** Internal steps only: the built-in tool and its arguments. */
  readonly toolId?: string;
  readonly args?: ToolArgs;
  /** Outward steps only. */
  readonly need?: OutwardNeed;
}

export interface LaunchProgramInput {
  readonly companyName: string;
  readonly companyId: string;
  readonly model: BusinessModel;
  readonly oneLiner: string;
  readonly currency: string;
  /** Budget the founder is prepared to lose finding out, in minor units. */
  readonly testBudgetMinor: number;
  readonly startDate: string;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ internals --- */

function foundationSteps(input: LaunchProgramInput): LaunchStep[] {
  const { companyName, model, oneLiner, currency, testBudgetMinor, startDate } = input;

  return [
    {
      id: 'goal',
      title: 'Set the goal the first ninety days are judged against',
      why: 'Everything below is only worth doing if it moves one number. Naming it first makes the rest of the programme falsifiable.',
      capabilityId: 'strategy',
      kind: 'internal',
      toolId: 'create_goal',
      args: {
        title: FIRST_GOAL[model],
        horizon: 'quarter',
        capabilityId: 'strategy',
        targetDate: addDays(startDate, 90),
        description: `${companyName}: ${oneLiner}`,
        why: 'The first goal exists to prove or kill the idea quickly, not to be impressive.',
      },
    },
    {
      id: 'positioning',
      title: 'Write the positioning and the offer on one page',
      why: 'A store, an ad and a landing page are all the same sentence in different clothes. Writing it once stops three versions of the business existing.',
      capabilityId: 'strategy',
      kind: 'internal',
      toolId: 'write_doc',
      args: {
        title: `${companyName} — positioning and offer`,
        kind: 'doc',
        capabilityId: 'strategy',
        body: positioningDoc(input),
        tags: 'launch,positioning',
      },
    },
    {
      id: 'brand',
      title: 'Fix the brand voice and visual direction',
      why: 'Creative gets generated in volume later. Without this written down, volume means drift.',
      capabilityId: 'branding',
      kind: 'internal',
      toolId: 'write_doc',
      args: {
        title: `${companyName} — brand direction`,
        kind: 'doc',
        capabilityId: 'branding',
        body: brandDoc(input),
        tags: 'launch,brand',
      },
    },
    {
      id: 'unit-economics',
      title: 'Write down the unit economics before spending anything',
      why: 'The number that kills this business is knowable in advance. Deciding the ceiling now is cheaper than discovering it from a bank statement.',
      capabilityId: 'finance',
      kind: 'internal',
      toolId: 'write_doc',
      args: {
        title: `${companyName} — unit economics and the kill criteria`,
        kind: 'decision',
        capabilityId: 'finance',
        body: economicsDoc(input),
        tags: 'launch,finance',
      },
    },
    {
      id: 'kpi-primary',
      title: `Track ${PRIMARY_KPI[model].label}`,
      why: 'One primary number, watched weekly. A dashboard of twelve is a dashboard nobody reads.',
      capabilityId: PRIMARY_KPI[model].capabilityId,
      kind: 'internal',
      toolId: 'add_kpi',
      args: {
        label: PRIMARY_KPI[model].label,
        value: 0,
        format: PRIMARY_KPI[model].format,
        direction: 'up-good',
        capabilityId: PRIMARY_KPI[model].capabilityId,
        period: 'this week',
        target: PRIMARY_KPI[model].target,
      },
    },
    {
      id: 'kpi-cost',
      title: 'Track the cost of acquiring one customer',
      why: 'Revenue without this number is a story. With it, every marketing decision has an answer.',
      capabilityId: 'marketing',
      kind: 'internal',
      toolId: 'add_kpi',
      args: {
        label: 'Cost per acquisition',
        value: 0,
        format: 'money',
        direction: 'down-good',
        capabilityId: 'marketing',
        period: 'this week',
        currency,
      },
    },
    {
      id: 'budget',
      title: 'Book the test budget as a forecast, not a hope',
      why: 'Money you have decided to lose is a plan. Money you have not written down is a surprise.',
      capabilityId: 'finance',
      kind: 'internal',
      toolId: 'add_finance_entry',
      args: {
        date: startDate,
        direction: 'out',
        amountMinor: testBudgetMinor,
        currency,
        label: `${companyName} launch test budget`,
        category: 'marketing',
        confidence: 'forecast',
        recurring: false,
      },
    },
    {
      id: 'roadmap',
      title: 'Put the first shippable thing on the roadmap',
      why: 'The programme has an end: something a stranger can buy from or book. Everything else is preparation for that.',
      capabilityId: 'development',
      kind: 'internal',
      toolId: 'add_roadmap_item',
      args: {
        title: FIRST_SHIP[model],
        stage: 'planned',
        horizon: 'this quarter',
        capabilityId: 'development',
        summary: `The smallest version of ${companyName} a stranger can transact with. ${BUSINESS_MODEL_NOTES[model]}`,
        confidence: 0.6,
      },
    },
    {
      id: 'brief',
      title: 'Write the creative brief the launch assets are made from',
      why: 'Generated creative is only as good as the brief behind it, and a brief is the thing you can argue with before spending on production.',
      capabilityId: 'creative',
      kind: 'internal',
      toolId: 'create_brief',
      args: {
        title: `${companyName} launch campaign`,
        objective: `Get the first ${FIRST_MILESTONE[model]} from cold traffic, and learn which message did it.`,
        audience: audienceFor(input),
        keyMessage: oneLiner,
        formats: 'social-post,ad-copy,image,video-script',
        mustInclude: 'the offer, the price, one reason to believe',
        mustAvoid: 'invented reviews, invented numbers, urgency that is not real',
        channel: CHANNEL[model],
      },
    },
    {
      id: 'risk-supplier',
      title: RISK[model].title,
      why: RISK[model].why,
      capabilityId: 'operations',
      kind: 'internal',
      toolId: 'add_risk',
      args: {
        label: RISK[model].title,
        detail: RISK[model].why,
        severity: 'high',
        kind: 'risk',
        capabilityId: 'operations',
        mitigation: RISK[model].mitigation,
      },
    },
    {
      id: 'task-decide-offer',
      title: 'Decide the price and what is included',
      why: 'The one decision nothing downstream can be built without, and the one an agent should not make alone.',
      capabilityId: 'strategy',
      kind: 'internal',
      toolId: 'create_task',
      args: {
        title: `Set the price and the inclusions for ${companyName}`,
        capabilityId: 'strategy',
        status: 'next',
        priority: 'p0',
        energy: 'deep',
        dueDate: addDays(startDate, 3),
        estimateMinutes: 90,
        notes: 'Blocks the storefront copy, the ad creative and the unit economics. Yours to decide, not the assistant’s.',
      },
    },
  ];
}

/* ------------------------------------------------------------- outward ---- */

function outwardSteps(input: LaunchProgramInput): LaunchStep[] {
  const { companyName, oneLiner, model } = input;

  return [
    {
      id: 'research-market',
      title: 'Read what the competition is actually saying',
      why: 'The positioning above is a hypothesis until it has been checked against the pages a customer will compare you to.',
      capabilityId: 'research',
      kind: 'outward',
      need: {
        intent: `Search the open web for how comparable ${BUSINESS_MODEL_LABELS[model].toLowerCase()} businesses describe their offer and price it.`,
        toolNameHints: ['search', 'fetch', 'browse', 'navigate', 'get'],
        presetId: 'fetch',
        payload: `${oneLiner} — competitors, pricing, positioning`,
      },
    },
    {
      id: 'domain',
      title: 'Check the name is actually available',
      why: 'Everything downstream carries the name. Finding out it is taken after the creative is made is an expensive way to learn it.',
      capabilityId: 'branding',
      kind: 'outward',
      need: {
        intent: `Check domain availability for ${companyName}.`,
        toolNameHints: ['domain', 'search', 'check', 'availability'],
        presetId: 'fetch',
        payload: companyName,
      },
    },
    {
      id: 'site',
      title: 'Build and publish the storefront',
      why: 'The first thing a stranger can transact with. Until this exists the business is a document.',
      capabilityId: 'development',
      kind: 'outward',
      need: {
        intent: `Create and deploy the ${companyName} site from the positioning and brand documents above.`,
        toolNameHints: ['deploy', 'create_app', 'publish', 'site', 'write_file', 'create_repo'],
        presetId: 'filesystem',
        payload: `${companyName}: ${oneLiner}`,
      },
    },
    {
      id: 'creative',
      title: 'Generate the launch creative',
      why: 'Paid traffic is a creative volume problem. The brief is written; this is where it becomes assets.',
      capabilityId: 'creative',
      kind: 'outward',
      need: {
        intent: `Generate launch images and video from the ${companyName} campaign brief.`,
        toolNameHints: ['image', 'video', 'generate', 'render', 'design'],
        payload: `${oneLiner} — launch campaign, brand direction as documented`,
      },
    },
    {
      id: 'publish',
      title: 'Post the launch to the channel',
      why: 'The first real test. Nothing before this produces a single piece of evidence about demand.',
      capabilityId: 'marketing',
      kind: 'outward',
      need: {
        intent: `Publish the launch post for ${companyName} to ${CHANNEL[model]}.`,
        toolNameHints: ['post', 'publish', 'tweet', 'send_message', 'upload'],
        presetId: 'slack',
        payload: `${companyName} is live. ${oneLiner}`,
      },
    },
    {
      id: 'measure',
      title: 'Pull the numbers back in',
      why: 'A campaign nobody reads the result of is a donation. This is what closes the loop into the KPIs above.',
      capabilityId: 'marketing',
      kind: 'outward',
      need: {
        intent: `Read campaign and traffic figures for ${companyName} and record them against the KPIs.`,
        toolNameHints: ['analytics', 'stats', 'metrics', 'get', 'query', 'report'],
        payload: `${companyName} launch performance`,
      },
    },
  ];
}

export function buildLaunchProgram(input: LaunchProgramInput): LaunchStep[] {
  return [...foundationSteps(input), ...outwardSteps(input)];
}

/**
 * Guess the shape of a business from how the founder described it.
 *
 * Only ever used to preselect a radio button. Getting it wrong costs one click,
 * which is why a keyword match is proportionate here and would not be if it
 * decided anything on its own.
 */
export function inferBusinessModel(businessModel: string, industry = ''): BusinessModel {
  const text = `${businessModel} ${industry}`.toLowerCase();
  if (/dropship|ecommerce|e-commerce|store|shop|retail|d2c|dtc/.test(text)) return 'dropshipping';
  if (/saas|software|platform|app|api|product-led/.test(text)) return 'saas';
  if (/content|media|newsletter|creator|audience|publish/.test(text)) return 'content';
  // Checked before the agency pattern: "local repair services" contains
  // "services", and the more specific signal has to win.
  if (/local|trades|clinic|salon|restaurant|repair|installation/.test(text)) return 'local-service';
  if (/agency|studio|consult|freelance|services|retainer/.test(text)) return 'agency';
  return 'agency';
}

/* --------------------------------------------------------- model detail --- */

const FIRST_GOAL: Record<BusinessModel, string> = {
  dropshipping: 'Fifty paid orders at a positive contribution margin',
  agency: 'Three paying clients on a repeatable offer',
  saas: 'Ten users who would be annoyed if it disappeared',
  content: 'A cadence held for twelve weeks without a gap',
  'local-service': 'Twenty booked jobs from within the service area',
};

const FIRST_SHIP: Record<BusinessModel, string> = {
  dropshipping: 'Storefront with one product, checkout and a returns policy',
  agency: 'One-page offer with a booking link and two proof points',
  saas: 'The one workflow that works end to end, with sign-up',
  content: 'Publishing setup with the first four pieces already written',
  'local-service': 'Booking page with the service area, prices and availability',
};

const FIRST_MILESTONE: Record<BusinessModel, string> = {
  dropshipping: 'ten orders',
  agency: 'three discovery calls',
  saas: 'twenty-five sign-ups',
  content: 'first thousand readers',
  'local-service': 'five bookings',
};

const CHANNEL: Record<BusinessModel, string> = {
  dropshipping: 'paid social',
  agency: 'a professional network',
  saas: 'the communities the problem is discussed in',
  content: 'the platform the audience already reads',
  'local-service': 'local search and local social',
};

const PRIMARY_KPI: Record<
  BusinessModel,
  { label: string; format: string; capabilityId: string; target: number }
> = {
  dropshipping: { label: 'Paid orders per week', format: 'number', capabilityId: 'sales', target: 50 },
  agency: { label: 'Qualified conversations per week', format: 'number', capabilityId: 'sales', target: 5 },
  saas: { label: 'Weekly active users', format: 'number', capabilityId: 'development', target: 10 },
  content: { label: 'Pieces published per week', format: 'number', capabilityId: 'marketing', target: 3 },
  'local-service': { label: 'Jobs booked per week', format: 'number', capabilityId: 'sales', target: 5 },
};

const RISK: Record<BusinessModel, { title: string; why: string; mitigation: string }> = {
  dropshipping: {
    title: 'One supplier and one ad account carry the whole business',
    why: 'Both can disappear without warning and neither failure is recoverable in the moment it happens.',
    mitigation:
      'Identify a second supplier before the first order ships. Keep product copy and creative in this workspace so the store can be rebuilt elsewhere.',
  },
  agency: {
    title: 'Revenue concentrated in the first client',
    why: 'The first client sets the price, the scope and the reputation, and losing them ends the business rather than denting it.',
    mitigation: 'Keep two conversations live at all times. Write the offer down so it is not re-improvised per client.',
  },
  saas: {
    title: 'Building past the point of evidence',
    why: 'The cheapest failure mode is a beautiful product nobody asked for, and it is the easiest one to walk into.',
    mitigation: 'No second feature until ten people have used the first one unprompted.',
  },
  content: {
    title: 'Cadence collapses before compounding starts',
    why: 'Everything about this model is a function of consistency, and consistency fails quietly.',
    mitigation: 'Bank four pieces before publishing the first. Treat the queue length as the health metric.',
  },
  'local-service': {
    title: 'Demand outruns the ability to deliver it',
    why: 'Over-promising locally costs a reputation that took the whole launch to build.',
    mitigation: 'Cap bookings per week at what can be delivered well, and say so on the booking page.',
  },
};

/* ------------------------------------------------------------ documents --- */

function audienceFor(input: LaunchProgramInput): string {
  return `Someone who already has the problem described in "${input.oneLiner}" and has tried at least one other way to solve it.`;
}

function positioningDoc(input: LaunchProgramInput): string {
  const { companyName, oneLiner, model } = input;
  return [
    `# ${companyName}`,
    '',
    `**One line.** ${oneLiner}`,
    '',
    '## Who it is for',
    audienceFor(input),
    '',
    '## What it replaces',
    'Name the thing they do today. If nothing, this is a habit problem before it is a product problem, and the launch has to account for that.',
    '',
    '## Why this shape of business',
    BUSINESS_MODEL_NOTES[model],
    '',
    '## The offer',
    'Price, what is included, what is explicitly not. Left blank on purpose — this is the one decision the assistant should not make for you, and there is a p0 task for it.',
    '',
    '## What would prove this wrong',
    `If ${FIRST_MILESTONE[model]} cannot be reached inside ninety days at an acceptable cost, the hypothesis was wrong rather than the execution.`,
    '',
    '_Drafted by OmniOS from the company you created. Every line above is a hypothesis, not a finding._',
  ].join('\n');
}

function brandDoc(input: LaunchProgramInput): string {
  const { companyName, model } = input;
  return [
    `# ${companyName} — brand direction`,
    '',
    '## Voice',
    'Plain, specific, unhurried. Claims are checkable. No superlatives that cannot be defended, no urgency that is not real.',
    '',
    '## What we never do',
    '- Invent a review, a testimonial or a number',
    '- Imply scarcity that does not exist',
    '- Use a stock photograph of a person as though they were a customer',
    '',
    '## Visual direction',
    `Restrained. One accent, one typeface, generous space. ${BUSINESS_MODEL_NOTES[model]}`,
    '',
    '## Where this is used',
    'Every generated asset is briefed against this document. When creative starts drifting, this is the thing that was not read.',
  ].join('\n');
}

function economicsDoc(input: LaunchProgramInput): string {
  const { companyName, currency, testBudgetMinor, model } = input;
  const budget = (testBudgetMinor / 100).toFixed(2);
  return [
    `# ${companyName} — unit economics`,
    '',
    '## The only equation that matters',
    'Contribution per sale = price − cost of goods − payment fees − shipping − acquisition cost.',
    'If that number is negative, volume makes the loss bigger. Nothing else in the programme changes that.',
    '',
    '## Test budget',
    `${currency} ${budget}, booked as a forecast. This is money already decided to be lost in exchange for evidence.`,
    '',
    '## Kill criteria',
    `Stop if the test budget is spent without reaching ${FIRST_MILESTONE[model]}, or if contribution per sale stays negative once acquisition cost is included.`,
    '',
    '## What is unknown',
    'Price and cost of goods are not filled in, because they are not known yet. They are blank rather than estimated — an estimate here would be indistinguishable from a fact three weeks from now.',
  ].join('\n');
}
