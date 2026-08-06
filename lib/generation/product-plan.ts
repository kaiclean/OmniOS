/**
 * The AI Product Factory's planner.
 *
 * Four sentences from a founder become a twelve-section product plan. No model is
 * called: the plan is a deterministic expansion of the founder's own words against
 * a fixed body of product-development practice, seeded by the input so the same
 * idea always produces the same plan on any machine.
 *
 * That constraint is the honest description of what this feature is today, and it
 * is why every spec returned here carries `simulated: true`. The value is real —
 * the sections, the sequencing and the questions are the ones that actually decide
 * whether a small product ships — but nothing in it has met a user, and the plan
 * says so out loud in `openQuestions`.
 */

import type { ProductPlanBlock, ProductPlanSection, ProductSpec, Scope } from '@/lib/domain';
import { PRODUCT_PLAN_SECTIONS, makeRecordId, scopeKey, slugify } from '@/lib/domain';
import type { Rng } from './rng';
import { createRng } from './rng';

export interface ProductPlanInput {
  readonly idea: string;
  readonly problem: string;
  readonly audience: string;
  readonly scope: Scope;
  /** Optional working name. Derived from the idea when the founder has not picked one. */
  readonly name?: string;
}

/* ------------------------------------------------------------- language --- */

/**
 * Words that carry no meaning when we are looking for the distinctive noun in an
 * idea. Kept small on purpose: over-filtering produces worse entity names than
 * under-filtering does.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'that', 'this', 'these', 'those',
  'from', 'into', 'over', 'about', 'their', 'they', 'them', 'when', 'what', 'which',
  'have', 'has', 'been', 'will', 'would', 'could', 'should', 'make', 'makes', 'made',
  'help', 'helps', 'tool', 'thing', 'stuff', 'just', 'like', 'more', 'most', 'some',
  'app', 'platform', 'system', 'service', 'product', 'people', 'users', 'user',
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Collapse whitespace and cut on a word boundary — generated prose should read as written. */
function shorten(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/[\s,;:.]+\S*$/, '')}…`;
}

function stripTrailingStop(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

/**
 * The most distinctive word in the idea, used to name the core entity in the
 * database and API sections. A plan that says `route` table instead of `item`
 * table is the difference between a template and something worth reading.
 */
function entityWord(idea: string, fallback: string): string {
  const candidates = words(idea).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const best = candidates.sort((a, b) => b.length - a.length)[0];
  const chosen = best ?? words(fallback).find((w) => w.length >= 3) ?? 'record';
  // Crude de-pluralisation: `routes` -> `route`. Wrong for "status"; harmless there.
  return chosen.length > 4 && chosen.endsWith('s') && !chosen.endsWith('ss')
    ? chosen.slice(0, -1)
    : chosen;
}

/** A working name when the founder did not supply one. Deliberately plain. */
function deriveName(idea: string): string {
  const clean = stripTrailingStop(idea).replace(/^(a|an|the)\s+/i, '');
  const first = clean.split(/[,.;:—-]/)[0] ?? clean;
  const trimmed = shorten(first, 42).replace(/…$/, '');
  if (!trimmed) return 'Untitled product';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/* ------------------------------------------------------------- sections --- */

interface PlanCtx {
  readonly rng: Rng;
  readonly name: string;
  readonly idea: string;
  readonly problem: string;
  readonly audience: string;
  /** Display form of the core entity, e.g. `Route`. */
  readonly entity: string;
  /** Table/route form of the core entity, e.g. `route`. */
  readonly table: string;
  readonly slug: string;
}

interface SectionAuthor {
  readonly heading: string;
  /** Must be a real id from lib/ai/specialists.ts — the UI resolves it to a name. */
  readonly specialistId: string;
  /** Bullets that always apply, written from the founder's own answers. */
  readonly always: (c: PlanCtx) => readonly string[];
  /** Practice the planner draws two or three of, so two ideas do not read identically. */
  readonly options: (c: PlanCtx) => readonly string[];
}

/**
 * Typed as a total Record, so adding a section to PRODUCT_PLAN_SECTIONS fails to
 * compile until it has an author. Twelve-section coverage is a promise this file
 * keeps structurally rather than by discipline.
 */
const AUTHORS: Record<ProductPlanSection, SectionAuthor> = {
  requirements: {
    heading: 'What it has to do',
    specialistId: 'project-manager',
    always: (c) => [
      `The line everything is judged against: ${c.problem}. A feature that does not move it is out of v1.`,
      `Written from ${c.audience} side of the screen — a requirement nobody there would ask for is a requirement we invented.`,
      `Minimum viable path: capture a ${c.table}, see it in one list, and take the single action that produces the outcome they came for.`,
    ],
    options: () => [
      'Explicitly out of v1: multi-user accounts, billing, notifications, and anything that needs a support inbox.',
      'Acceptance for each requirement is a sentence a non-engineer can check by using the thing, not a ticket status.',
      'Set the cut line now: if the build passes three weeks, ship the narrowest version and keep the remainder as a list.',
      'Non-functional floor: usable on a phone, understandable without explanation, and recoverable after a mistake.',
      'One measurable success condition agreed before any code — what has to be true in week four for this to continue.',
    ],
  },
  ux: {
    heading: 'The path through it',
    specialistId: 'designer',
    always: (c) => [
      `First run reaches value without setup: land, see one worked example, create the first ${c.table} in under two minutes.`,
      'The core loop is three steps. Anything done more than twice in a session earns a shortcut.',
      `Because the audience is ${c.audience}, assume interruption: every screen has to survive being left and returned to.`,
    ],
    options: () => [
      'Empty states carry the instruction. A blank screen with a plus button teaches nothing.',
      'Error states name what failed, what was kept, and the next action — never a code on its own.',
      'Design the slow path first: bad connectivity, stale data, and a request that takes eight seconds.',
      'One primary action per screen. Two competing buttons is a decision the user did not ask to make.',
      'Every mouse path has a keyboard path; the user who stays is the one who stops reaching for the mouse.',
      'Destructive actions are reversible rather than confirmed — undo beats "are you sure".',
    ],
  },
  ui: {
    heading: 'How it looks, and what it may not do',
    specialistId: 'brand',
    always: (c) => [
      `Tokens before screens: colour, spacing, radius and type scale defined once, so ${c.name} does not drift as screens accumulate.`,
      'Two type sizes and one accent colour to start. A third arrives only when a real screen demands it.',
      'A component is not done until it ships its loading, empty, error and dense states.',
    ],
    options: () => [
      'No gradients, no glow, no second accent. Visual interest comes from spacing and hierarchy or it is decoration.',
      'Contrast checked at AA for body text before any palette is signed off.',
      'Icons drawn on one grid at one stroke weight — a mixed icon set reads as assembled from parts.',
      'Numbers are tabular and right-aligned wherever they are compared to each other.',
      'Dark and light are the same design, not two designs.',
      'Absence renders as a dash, never as a zero. A fabricated zero is a lie the interface tells quietly.',
    ],
  },
  backend: {
    heading: 'The service behind it',
    specialistId: 'architect',
    always: (c) => [
      `One service. ${c.name} does not have the traffic to justify a second, and splitting later is far cheaper than merging.`,
      `Model the domain around ${c.entity} first — every other table and screen is a view over it.`,
      'Business rules live in one layer the request handlers call, so the handlers stay thin enough to replace.',
    ],
    options: () => [
      'Idempotency keys on anything a user can trigger twice by double-clicking.',
      'Background work goes on a queue with a visible dead-letter list, not a fire-and-forget timer.',
      'Structured logs with a request id from the first commit — you cannot add them during an incident.',
      'Secrets read from the environment only. Nothing in the repository, nothing in the client bundle.',
      'Every external call gets a timeout, a retry budget, and a written answer to "what happens when it is down".',
      'A storage adapter behind one interface, so the first database choice is not a permanent one.',
    ],
  },
  frontend: {
    heading: 'The interface layer',
    specialistId: 'engineer',
    always: (c) => [
      'Server-rendered by default; client state only where interaction genuinely requires it.',
      `Data flows one way — the server reads ${c.entity} records, the client sends intent back through actions.`,
      'Ship the working slice before the animation. A fast unstyled path beats a slow polished one every week of the build.',
    ],
    options: () => [
      'Optimistic updates only where the failure case is cheap to undo.',
      'No component library for the first release; the design system above is smaller than the configuration you would write.',
      'A bundle budget enforced in CI, so growth is a decision rather than a discovery.',
      'Every interactive element reachable and operable by keyboard, verified by hand rather than by linter.',
      'Reduced motion respected globally rather than remembered per animation.',
      'One loading convention across the app — mixing spinners and skeletons reads as two products.',
    ],
  },
  database: {
    heading: 'What is stored, and how',
    specialistId: 'architect',
    always: (c) => [
      `Three tables to start: ${c.table}, ${c.table}_event for the audit trail, and one account table. Resist a fourth until a query demands it.`,
      'Every row carries created_at, updated_at and the id of whatever created it. Retrofitting provenance is miserable.',
      'Money in integer minor units, timestamps in UTC, no nullable booleans.',
    ],
    options: () => [
      'Soft delete via deleted_at until there is a retention policy that says otherwise.',
      'Indexes added from measured slow queries, never from imagination.',
      'Migrations are forward-only; a mistake is corrected by writing the next one.',
      'A seed script producing a realistic dataset, so nobody develops against three empty rows.',
      'An export path from day one — data a user cannot get out is data they will hesitate to put in.',
      'Personal data isolated in its own table with its own access path, so deleting a person is one operation.',
    ],
  },
  api: {
    heading: 'The contract',
    specialistId: 'engineer',
    always: (c) => [
      `Four calls to begin: list ${c.table}s, read one, create one, and the single action that resolves the problem.`,
      `Versioned at /api/v1/${c.slug} from the first commit. Adding a version later breaks every client at once.`,
      'Errors have a stable shape: machine code, human sentence, and whether retrying will help.',
    ],
    options: () => [
      'Rate limit by account rather than by IP — the first abusive client will be a legitimate one with a bad loop.',
      'Cursor pagination. Offset pagination breaks the moment rows are inserted mid-scroll.',
      'Anything long-running returns a job id instead of holding the connection open.',
      'Write the request and response examples before implementing; they are the specification.',
      'Authentication decided once at the edge — no handler forms its own opinion about who is calling.',
      'Field additions only; removing or renaming a field is a new version, not a patch.',
    ],
  },
  documentation: {
    heading: 'What has to be written down',
    specialistId: 'operator',
    always: (c) => [
      'A README that takes a fresh machine from clone to running in under ten minutes, tested by someone who has never done it.',
      `A one-page note on why ${c.name} exists — ${c.problem} — kept beside the code so it ages with it.`,
      'Decisions recorded when made, including the option that was rejected and the reason.',
    ],
    options: () => [
      'User help written as answers to questions people actually ask, not as a feature tour.',
      'A runbook for the three failures most likely at 3am, with the exact commands to run.',
      'Comments explain why. The code already says what.',
      'A changelog written for the person upgrading, not for the person who shipped.',
      'One page listing every external dependency, what it costs, and what breaks if it disappears.',
    ],
  },
  testing: {
    heading: 'How it is proven',
    specialistId: 'qa',
    always: (c) => [
      `One end-to-end test walking the full loop ${c.audience} perform. It catches more than fifty unit tests placed around it.`,
      'Pure logic — pricing, scheduling, scoring, permissions — is unit tested and deterministic. No clocks, no randomness.',
      'Every bug gets its failing test first. Without it the bug returns, usually in the same month.',
    ],
    options: () => [
      'Test the denied, empty and degraded paths, not only the happy one.',
      'Fixtures over mocks where possible: a mock drifts from reality and keeps passing while production fails.',
      'CI runs typecheck, lint and tests on every push and blocks merge on red.',
      'A manual pass on a real phone before each release. Emulators forgive things phones do not.',
      'One load check at ten times expected volume, early, to find the wall before a customer does.',
      'A restore from backup rehearsed and timed — an untested backup is a hope, not a backup.',
    ],
  },
  deployment: {
    heading: 'Getting it into the world',
    specialistId: 'automation',
    always: () => [
      'One command from commit to production, and the same command in every environment.',
      'Rollback is a deploy of the previous build, practised once before it is ever needed.',
      'Staging holds the real schema and realistic data. A staging environment that lies is worse than none.',
    ],
    options: () => [
      'A health check and an uptime alert reaching a phone before the first external user arrives.',
      'Error tracking wired before launch, with a named person receiving it.',
      'Backups automated, and the restore rehearsed — the second half is the one people skip.',
      'Feature flags for anything risky, so a bad release is a toggle rather than a rollback.',
      'Infrastructure described in a file in the repository, not in a console someone remembers configuring.',
      'Deploys during hours when the person who can fix it is awake.',
    ],
  },
  marketing: {
    heading: 'How anyone hears about it',
    specialistId: 'marketer',
    always: (c) => [
      `Positioning tested before any spend: ${c.name} exists because ${c.problem}. If ${c.audience} do not repeat that back, the words are wrong.`,
      'One channel first, chosen because that audience is already there, worked until it compounds or is disproven.',
      'Proof over adjectives — show it working on a real case, including the part that is still unfinished.',
    ],
    options: () => [
      'A page that states what it does, who it is for, what it costs, and one way to start. Nothing else.',
      'Price named publicly. A hidden price filters out the buyers who were already ready.',
      'Collect the objection that ends conversations and answer it on the page.',
      'One channel metric that is not impressions, reviewed weekly, killed if flat after a month.',
      'Nothing claimed that cannot be demonstrated on request.',
      'Ten conversations with the audience before any paid acquisition — cheaper than the ads and more informative.',
    ],
  },
  launch: {
    heading: 'The first release',
    specialistId: 'chief-of-staff',
    always: (c) => [
      `Release privately to ${c.rng.int(8, 25)} people who match ${c.audience} first, while it can still be fixed quietly.`,
      'Go/no-go conditions written in advance: what has to work, and what is allowed to be broken.',
      'The week after launch belongs to what launch reveals. Do not schedule the next feature into it.',
    ],
    options: () => [
      'One owner on call for the first 72 hours, with the authority to roll back without asking.',
      'A written path for the first complaint: who reads it, who answers, and how fast.',
      'Announce when it works rather than to a date, unless the date is contractual.',
      'Measure activation — people who reached the outcome — not sign-ups.',
      'A decision date four weeks out to continue, change or stop, written down now while honesty is still cheap.',
      'A list of what was cut, kept visible, so the second release is chosen rather than remembered.',
    ],
  },
};

/**
 * What the plan does not know.
 *
 * The last entry is never sampled away: a generated plan that does not admit its
 * own provenance is the failure mode this whole feature is built to avoid.
 */
function buildOpenQuestions(c: PlanCtx): string[] {
  const pool = [
    `Will ${c.audience} pay for this, and how much? Nothing above has tested a price.`,
    'Where does the data come from on day one, and who owns it once it is in here?',
    `What does ${c.name} do when it is wrong? The plan assumes correct output on every path.`,
    'Is any of this data personal, financial or health-related — and does that change the obligations?',
    'Who maintains this in month six, and what does its continued existence cost per month?',
    'What already solves this well enough today, and why would someone switch?',
    'What volume must it hold? Ten users and ten thousand imply different answers above.',
    `What is the smallest version that could prove ${c.problem} is not actually worth solving?`,
    'Which existing tool would this have to sit beside, and does that force an integration into v1?',
  ];
  return [
    ...c.rng.sample(pool, 5),
    'Which parts of this plan are guessing? All of it was expanded from four sentences and has not met a user.',
  ];
}

function buildBlock(section: ProductPlanSection, c: PlanCtx): ProductPlanBlock {
  const author = AUTHORS[section];
  return {
    section,
    heading: author.heading,
    specialistId: author.specialistId,
    bullets: [...author.always(c), ...c.rng.sample(author.options(c), c.rng.int(2, 3))],
  };
}

/**
 * Turn four answers into a full product specification.
 *
 * Deterministic given the same input and the same `now`: the id is time-seeded so
 * a founder can plan the same idea twice and get two records, but the *content*
 * of those two plans is identical, which is what makes this testable.
 */
export function generateProductPlan(input: ProductPlanInput, now: Date = new Date()): ProductSpec {
  const idea = stripTrailingStop(input.idea);
  const problem = stripTrailingStop(input.problem);
  const audience = stripTrailingStop(input.audience);
  const name = input.name?.trim() || deriveName(idea);
  const table = entityWord(idea, name);

  const seed = `${scopeKey(input.scope)}:${idea}:${problem}:${audience}`;
  const rng = createRng(seed);

  const ctx: PlanCtx = {
    rng,
    name,
    idea: shorten(idea, 180),
    problem: shorten(lowerFirst(problem), 140),
    audience: shorten(lowerFirst(audience), 90),
    entity: table.charAt(0).toUpperCase() + table.slice(1),
    table,
    slug: slugify(name) || 'product',
  };

  const timestamp = now.toISOString();

  return {
    id: makeRecordId('spec', `${seed}:${timestamp}`),
    scope: input.scope,
    createdAt: timestamp,
    updatedAt: timestamp,
    name,
    idea,
    problem,
    audience,
    // Nothing here has been reviewed by the founder yet, so it is a draft and says so.
    status: 'drafting',
    blocks: PRODUCT_PLAN_SECTIONS.map((section) => buildBlock(section, ctx)),
    openQuestions: buildOpenQuestions(ctx),
    simulated: true,
  };
}

/** Founders capitalise their answers; these get spliced mid-sentence. */
function lowerFirst(text: string): string {
  if (!text) return text;
  // Leave acronyms and proper nouns alone — "GDPR reporting" must not become "gDPR".
  if (text.slice(0, 2) === text.slice(0, 2).toUpperCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
