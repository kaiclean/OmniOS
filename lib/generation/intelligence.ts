/**
 * The AI Intelligence Center's content, and the Safe Upgrade Pipeline's fixtures.
 *
 * The bundled feed is a curated sample set, marked `simulated: true` everywhere it
 * appears. Setting `OMNIOS_INTEL_FEED_URL` is the seam where a real source
 * replaces it — the scoring, triage and pipeline stages are already real code and
 * do not change when the feed becomes live.
 */

import type {
  Discovery,
  LearningReport,
  ReportSection,
  SandboxResult,
  UpgradeCandidate,
} from '@/lib/domain';
import { makeRecordId, sharedScope } from '@/lib/domain';
import type { Rng } from './rng';
import { createRng, round } from './rng';

const iso = (d: Date): string => d.toISOString();
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/** Discoveries live in a shared capability scope — they belong to no company. */
const INTEL_SCOPE = sharedScope('research');

function base(kind: string, seed: string, now: Date) {
  return {
    id: makeRecordId(kind, `intel:${seed}`),
    scope: INTEL_SCOPE,
    createdAt: iso(now),
    updatedAt: iso(now),
  };
}

interface DiscoverySeed {
  readonly title: string;
  readonly kind: Discovery['kind'];
  readonly summary: string;
  readonly sourceLabel: string;
  readonly relevance: number;
  readonly reasons: readonly string[];
  readonly affects: readonly string[];
  readonly ageDays: number;
}

/**
 * Deliberately mixed quality. An intelligence feed that only surfaces exciting
 * things is a hype feed; the point of the relevance score is that most of what
 * appears should be scored *down* and filtered out.
 */
const DISCOVERY_SEEDS: readonly DiscoverySeed[] = [
  {
    title: 'Long-context retrieval without a vector database',
    kind: 'practice',
    summary:
      'Structured scoping plus keyword pre-filtering matches embedding search on small corpora, at a fraction of the operational cost.',
    sourceLabel: 'Engineering write-up',
    relevance: 88,
    reasons: [
      'OmniOS memory is scoped and small per space — exactly the regime where this wins',
      'Removes a dependency the memory layer was going to need',
      'Directly reduces the cost of the planned vector upgrade',
    ],
    affects: ['Memory layer', 'Research capability'],
    ageDays: 3,
  },
  {
    title: 'Structured output modes cut agent parsing failures sharply',
    kind: 'practice',
    summary:
      'Schema-constrained generation removes most retry loops in multi-step agents; the win is largest where a plan must be machine-readable.',
    sourceLabel: 'Provider documentation',
    relevance: 82,
    reasons: [
      'Delegation plans are exactly this shape',
      'Would make the assistant’s reasoning summaries reliable rather than best-effort',
    ],
    affects: ['Assistant router', 'Specialist delegation'],
    ageDays: 6,
  },
  {
    title: 'Small local models now viable for classification and routing',
    kind: 'model',
    summary:
      'Sub-4B models on Apple Silicon are accurate enough for intent routing, keeping private data off the network entirely.',
    sourceLabel: 'Benchmark round-up',
    relevance: 79,
    reasons: [
      'Personal life data should not leave the machine for something as small as routing',
      'Removes a per-request cost from the most frequent operation in the system',
    ],
    affects: ['Assistant router', 'Personal scope privacy'],
    ageDays: 9,
  },
  {
    title: 'Incremental static regeneration patterns for founder dashboards',
    kind: 'workflow',
    summary: 'Cache overview aggregates and revalidate on mutation instead of recomputing per request.',
    sourceLabel: 'Framework guide',
    relevance: 61,
    reasons: ['Home and Finance Center recompute aggregates on every load today'],
    affects: ['Performance'],
    ageDays: 12,
  },
  {
    title: 'Open-source knowledge-graph store with an embedded mode',
    kind: 'open-source',
    summary: 'Graph queries over entities and relations without running a server.',
    sourceLabel: 'Repository release notes',
    relevance: 58,
    reasons: [
      'The memory layer’s stated future direction includes a knowledge graph',
      'Embedded mode fits the local-first constraint',
    ],
    affects: ['Memory layer'],
    ageDays: 15,
  },
  {
    title: 'A faster image generation model',
    kind: 'model',
    summary: 'Higher throughput at similar quality for marketing imagery.',
    sourceLabel: 'Model card',
    relevance: 44,
    reasons: ['Creative Studio has no provider wired yet, so speed is not the constraint'],
    affects: ['Creative Studio'],
    ageDays: 5,
  },
  {
    title: 'Agent framework release with a new orchestration DSL',
    kind: 'open-source',
    summary: 'Another way to express multi-agent graphs.',
    sourceLabel: 'Release announcement',
    relevance: 22,
    reasons: [
      'OmniOS already has a working router; adopting a framework would add surface without removing work',
    ],
    affects: [],
    ageDays: 8,
  },
  {
    title: 'Benchmark leaderboard reshuffle',
    kind: 'paper',
    summary: 'Rankings moved on a benchmark that does not resemble any task in this system.',
    sourceLabel: 'Leaderboard',
    relevance: 11,
    reasons: ['No workload here resembles the benchmark'],
    affects: [],
    ageDays: 2,
  },
];

export function generateDiscoveries(now: Date = new Date()): Discovery[] {
  return DISCOVERY_SEEDS.map((seed, i) => ({
    ...base('disc', `${i}:${seed.title}`, now),
    title: seed.title,
    kind: seed.kind,
    summary: seed.summary,
    sourceLabel: seed.sourceLabel,
    publishedAt: iso(addDays(now, -seed.ageDays)),
    relevance: seed.relevance,
    relevanceReasons: seed.reasons,
    affects: seed.affects,
    status: (seed.relevance >= 75 ? 'promoted' : seed.relevance >= 50 ? 'triaged' : 'new') as Discovery['status'],
    simulated: true,
  }));
}

/* ------------------------------------------------------ upgrade pipeline -- */

function sandbox(rng: Rng, now: Date, metrics: SandboxResult['metrics'], harness: string): SandboxResult {
  return {
    ranAt: iso(addDays(now, -rng.int(1, 5))),
    harness,
    trials: rng.int(20, 120),
    metrics,
    notes: [
      'Ran against a copy of the workspace, never the live one.',
      'No external side effects were permitted during the run.',
    ],
    simulated: true,
  };
}

export function generateUpgradeCandidates(
  discoveries: readonly Discovery[],
  now: Date = new Date(),
): UpgradeCandidate[] {
  const rng = createRng('upgrades:v1');
  const byTitle = new Map(discoveries.map((d) => [d.title, d]));

  const candidates: UpgradeCandidate[] = [
    {
      ...base('upg', 'structured-output', now),
      title: 'Schema-constrained delegation plans',
      discoveryId: byTitle.get('Structured output modes cut agent parsing failures sharply')?.id,
      stage: 'awaiting-approval',
      whatChanged:
        'The assistant would ask the model for a delegation plan as a schema-constrained object instead of parsing prose into one.',
      whyItMatters:
        'Every reasoning summary the founder sees depends on that plan being well-formed. Today a malformed plan degrades to a generic answer; with a schema it cannot be malformed.',
      whatWasTested:
        '80 routing prompts drawn from real capability areas, run against both paths on a copy of the workspace.',
      sandbox: sandbox(
        rng,
        now,
        [
          { label: 'Plans parsed successfully', baseline: 82, candidate: 100, unit: '%', betterWhen: 'higher' },
          { label: 'Median latency', baseline: 1.9, candidate: 2.1, unit: 's', betterWhen: 'lower' },
          { label: 'Retry loops', baseline: 14, candidate: 0, unit: 'per 80 runs', betterWhen: 'lower' },
        ],
        'router-plan-fidelity',
      ),
      benefits: [
        'Reasoning summaries become reliable rather than best-effort',
        'Removes the retry path entirely',
        'Makes delegation auditable by construction',
      ],
      risks: [
        {
          label: 'Slightly higher latency per turn',
          severity: 'low',
          mitigation: 'Stream the summary while the structured plan completes.',
        },
        {
          label: 'Ties the router to providers that support constrained output',
          severity: 'medium',
          mitigation: 'Keep the prose path as a fallback behind the same interface.',
        },
      ],
      recommendation:
        'Approve. The reliability gain is large, the cost is 200ms, and the fallback keeps provider choice open.',
      recommendationConfidence: 0.86,
      simulated: true,
    },
    {
      ...base('upg', 'local-router', now),
      title: 'Route personal-scope requests with a local model',
      discoveryId: byTitle.get('Small local models now viable for classification and routing')?.id,
      stage: 'measured',
      whatChanged:
        'Intent routing for personal-scope requests would run on a small local model, so personal text never leaves the machine for the routing step.',
      whyItMatters:
        'Routing is the most frequent operation in the system and the one that touches the most private text. Doing it locally removes a whole class of exposure.',
      whatWasTested:
        '120 personal-scope prompts routed by both paths; agreement measured against the current router’s choice.',
      sandbox: sandbox(
        rng,
        now,
        [
          { label: 'Agreement with current router', baseline: 100, candidate: 91, unit: '%', betterWhen: 'higher' },
          { label: 'Median routing latency', baseline: 640, candidate: 180, unit: 'ms', betterWhen: 'lower' },
          { label: 'Personal text sent off-device', baseline: 100, candidate: 0, unit: '%', betterWhen: 'lower' },
        ],
        'router-agreement',
      ),
      benefits: [
        'Personal text stops leaving the device for routing',
        'Routing gets roughly three times faster',
        'Works with no network at all',
      ],
      risks: [
        {
          label: '9% of routes disagree with the current router',
          severity: 'medium',
          mitigation:
            'Escalate low-confidence routes to the remote model; measure the disagreement set before widening.',
        },
        { label: 'Adds a local runtime dependency', severity: 'low', mitigation: 'Ship it optional, off by default.' },
      ],
      recommendation:
        'Test longer. The privacy and latency wins are real, but 9% disagreement needs to be understood before this handles a founder’s calendar.',
      recommendationConfidence: 0.64,
      simulated: true,
    },
    {
      ...base('upg', 'scoped-retrieval', now),
      title: 'Scoped keyword retrieval before adding embeddings',
      discoveryId: byTitle.get('Long-context retrieval without a vector database')?.id,
      stage: 'recommended',
      whatChanged:
        'Memory retrieval would use scope plus capability plus keyword ranking, deferring the embedding index until a space actually outgrows it.',
      whyItMatters:
        'It removes a dependency, keeps memory readable as plain JSON, and preserves the option to add vectors later without a migration.',
      whatWasTested:
        '60 retrieval prompts across a seeded workspace, judged on whether the right record appeared in the top three.',
      sandbox: sandbox(
        rng,
        now,
        [
          { label: 'Correct record in top 3', baseline: 88, candidate: 85, unit: '%', betterWhen: 'higher' },
          { label: 'Retrieval latency', baseline: 240, candidate: 6, unit: 'ms', betterWhen: 'lower' },
          { label: 'External dependencies', baseline: 1, candidate: 0, unit: 'count', betterWhen: 'lower' },
        ],
        'memory-recall',
      ),
      benefits: [
        'No vector service to run, pay for or secure',
        'Memory stays human-readable on disk',
        'Three points of recall traded for a 40× latency improvement',
      ],
      risks: [
        {
          label: 'Recall will degrade as a space grows past a few thousand records',
          severity: 'medium',
          mitigation: 'Keep the embedding field on MemoryRecord so an index can be added without a migration.',
        },
      ],
      recommendation: 'Approve for now, with a review once any single scope passes 2,000 memory records.',
      recommendationConfidence: 0.78,
      simulated: true,
    },
    {
      ...base('upg', 'graph-store', now),
      title: 'Embedded knowledge-graph store for cross-capability learning',
      discoveryId: byTitle.get('Open-source knowledge-graph store with an embedded mode')?.id,
      stage: 'analysed',
      whatChanged:
        'Shared capability memory would move from flat records to an entity/relation graph, so a lesson could carry the structure it was learned in.',
      whyItMatters:
        'Cross-company learning is a stated goal, and flat text loses the relationships that make a lesson transferable.',
      whatWasTested: 'Not yet run in the sandbox.',
      benefits: ['Relationships between lessons become queryable', 'Better cross-space transfer'],
      risks: [
        {
          label: 'Significant complexity for a benefit that has not been demonstrated yet',
          severity: 'high',
          mitigation: 'Do not proceed until shared memory has enough records for the flat version to visibly fail.',
        },
      ],
      recommendation:
        'Hold. Shared memory currently holds too few records for a graph to earn its complexity. Revisit when flat retrieval visibly fails.',
      recommendationConfidence: 0.71,
      simulated: true,
    },
  ];

  return candidates;
}

/* ------------------------------------------------------- learning report -- */

export function generateLearningReport(
  cadence: LearningReport['cadence'],
  discoveries: readonly Discovery[],
  upgrades: readonly UpgradeCandidate[],
  now: Date = new Date(),
): LearningReport {
  const rng = createRng(`report:${cadence}`);
  const days = cadence === 'daily' ? 1 : cadence === 'two-day' ? 2 : cadence === 'weekly' ? 7 : 30;
  const signal = discoveries.filter((d) => d.relevance >= 70);
  const noise = discoveries.length - signal.length;
  const awaiting = upgrades.filter((u) => u.stage === 'awaiting-approval');

  const sections: ReportSection[] = [
    {
      heading: 'Worth your attention',
      bullets: [
        ...signal.slice(0, 3).map((d) => ({
          text: `${d.title} — ${d.relevanceReasons[0] ?? d.summary}`,
          weight: 'signal' as const,
        })),
        {
          text: `${noise} further items were scored below the relevance threshold and filtered out.`,
          weight: 'context' as const,
        },
      ],
    },
    {
      heading: 'Waiting on you',
      bullets: awaiting.length
        ? awaiting.map((u) => ({
            text: `${u.title} — ${u.recommendation}`,
            weight: 'signal' as const,
            href: '/intelligence/upgrades',
          }))
        : [{ text: 'Nothing is waiting for a decision.', weight: 'context' as const }],
    },
    {
      heading: 'Systems',
      bullets: [
        {
          text: `${upgrades.filter((u) => u.sandbox).length} candidates were evaluated in the sandbox this period. None were applied — nothing applies without your approval.`,
          weight: 'signal',
        },
        {
          text: 'No automation performed an external action. Every run was internal.',
          weight: 'context',
        },
      ],
    },
    {
      heading: 'Health and energy',
      bullets: [
        {
          text: 'Recovery is the constraint on this period’s deep-work budget, not available hours.',
          weight: 'signal',
          href: '/life/health',
        },
      ],
    },
    {
      heading: 'Risks and bottlenecks',
      bullets: [
        { text: 'Founder remains in the critical path of every delivery in both companies.', weight: 'signal' },
        { text: 'Personal runway is below its twelve-month target.', weight: 'signal', href: '/finance' },
      ],
    },
  ];

  return {
    ...base('rep', `${cadence}`, now),
    cadence,
    periodStart: iso(addDays(now, -days)),
    periodEnd: iso(now),
    headline:
      awaiting.length > 0
        ? `${awaiting.length} upgrade${awaiting.length === 1 ? '' : 's'} waiting on you; ${signal.length} of ${discoveries.length} ecosystem items cleared the relevance bar.`
        : `${signal.length} of ${discoveries.length} ecosystem items cleared the relevance bar. Nothing needs a decision.`,
    sections,
    minutesSaved: rng.int(120, 420),
    moneySavedMinor: rng.int(0, 900) * 100,
    currency: 'CHF',
    read: false,
    simulated: true,
  };
}

export function generateAllReports(
  discoveries: readonly Discovery[],
  upgrades: readonly UpgradeCandidate[],
  now: Date = new Date(),
): LearningReport[] {
  return (['weekly', 'daily', 'monthly'] as const).map((cadence, i) =>
    generateLearningReport(cadence, discoveries, upgrades, addDays(now, -i * 2)),
  );
}

/** Relevance scoring, used when a real feed replaces the bundled sample set. */
export function scoreRelevance(
  item: { title: string; summary: string; kind: Discovery['kind'] },
  interests: readonly string[],
): { score: number; reasons: string[] } {
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  const reasons: string[] = [];
  let score = 20;

  for (const interest of interests) {
    if (haystack.includes(interest.toLowerCase())) {
      score += 14;
      reasons.push(`Touches "${interest}", which this workspace actively uses`);
    }
  }
  if (['practice', 'workflow'].includes(item.kind)) {
    score += 10;
    reasons.push('A practice change costs less to adopt than a dependency');
  }
  if (item.kind === 'paper') {
    score -= 8;
    reasons.push('Research without a shipped implementation rarely changes anything this quarter');
  }
  return { score: Math.max(0, Math.min(100, round(score))), reasons };
}
