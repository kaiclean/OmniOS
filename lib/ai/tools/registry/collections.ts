/**
 * The collection lists that bound what tools may delete, search or reset.
 *
 * Plain constants. The append-only collections (the audit trail) are absent
 * from the deletable and searchable lists on purpose; see each comment.
 */

import type { CollectionName } from '@/lib/data/schema';

/* ----------------------------------------------------------- deletion ----- */

/**
 * Collections `delete_record` may touch.
 *
 * Everything append-only is missing on purpose: `toolCalls`, `agentRuns`,
 * `automationRuns`, `messages` and `evolution` are the record of what the system
 * did and what it concluded. A tool that can erase its own audit trail makes
 * every other guarantee here unfalsifiable.
 */
export const DELETABLE_COLLECTIONS = [
  'tasks',
  'goals',
  'kpis',
  'roadmap',
  'automations',
  'docs',
  'contacts',
  'finance',
  'risks',
  'suggestions',
  'notifications',
  'memory',
  'briefs',
  'assets',
  'products',
  'health',
  'habits',
  'relationships',
  'learning',
  'lifeAdmin',
  'calendar',
  'observations',
  'routingHints',
  'specialistScores',
  'customAgents',
] as const satisfies readonly CollectionName[];

export type DeletableCollection = (typeof DELETABLE_COLLECTIONS)[number];

/**
 * Collections `reset_capability_data` clears, all of which carry a `capabilityId`.
 * `evolution` is deliberately absent for the same reason as above.
 */
/**
 * What the assistant may look through.
 *
 * Not every collection: `messages` and `agentRuns` are the assistant's own
 * transcript, and letting it search those turns a question about the founder's
 * work into a question about itself. `toolCalls` is excluded for the same
 * reason — the audit trail is for the founder to read, not for the thing being
 * audited to mine.
 */
export const SEARCHABLE_COLLECTIONS = [
  'tasks', 'goals', 'kpis', 'roadmap', 'automations', 'docs', 'contacts',
  'finance', 'risks', 'suggestions', 'briefs', 'assets', 'products', 'health',
  'habits', 'relationships', 'learning', 'lifeAdmin', 'calendar', 'memory',
] as const;

export const CAPABILITY_SCOPED_COLLECTIONS = [
  'tasks',
  'goals',
  'kpis',
  'roadmap',
  'automations',
  'docs',
  'risks',
  'suggestions',
  'memory',
  'observations',
] as const satisfies readonly CollectionName[];

export type CapabilityScopedCollection = (typeof CAPABILITY_SCOPED_COLLECTIONS)[number];

/** CalendarBlock's kind is an inline union on the record, so it is restated here. */
export const CALENDAR_BLOCK_KINDS = [
  'deep-work',
  'meeting',
  'admin',
  'rest',
  'personal',
  'travel',
] as const;
