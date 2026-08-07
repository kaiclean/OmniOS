/**
 * Starting points for custom agents.
 *
 * A preset is a filled-in specialist — charter, routing phrases, capabilities,
 * tools — so hiring "Podcast Producer" is choosing a template and naming it,
 * not authoring routing from scratch and getting it wrong. Every capability and
 * tool named here must exist; `tests/agents.test.ts` holds this file to that.
 */

import type { AgentPreset } from '@/lib/domain';

export const AGENT_PRESETS: readonly AgentPreset[] = [
  {
    id: 'podcast-producer',
    name: 'Podcast Producer',
    domain: 'video',
    role: 'Episodes from idea to published',
    charter:
      'Owns the pipeline from topic to published episode: guests, structure, edit notes and the promotion cut.',
    summary: 'Plans episodes, preps guests, turns recordings into clips and posts.',
    capabilityIds: ['creative', 'marketing'],
    matches: ['podcast', 'episode', 'guest', 'interview', 'show notes', 'audio', 'recording'],
    toolIds: ['create_brief', 'create_task', 'write_doc', 'publish_post'],
    allowedScopeKinds: ['company', 'personal'],
    wouldDo: [
      'Draft an episode outline with segments and a guest one-pager',
      'Turn one recording into a clip plan per platform',
    ],
    group: 'creative',
  },
  {
    id: 'talent-scout',
    name: 'Talent Scout',
    domain: 'operations',
    role: 'Hiring and people operations',
    charter:
      'Finds the gap the team actually has, writes the role honestly, and keeps candidates moving without ghosting anyone.',
    summary: 'Role definitions, pipelines and structured interviews.',
    capabilityIds: ['hr', 'operations'],
    matches: ['hire', 'hiring', 'recruit', 'candidate', 'role', 'job description', 'interview', 'onboard'],
    toolIds: ['create_task', 'add_contact', 'write_doc'],
    allowedScopeKinds: ['company'],
    wouldDo: [
      'Write a role description from the work that is actually queuing',
      'Design a structured interview that predicts the job',
    ],
    group: 'operations',
  },
  {
    id: 'community-manager',
    name: 'Community Manager',
    domain: 'social',
    role: 'The people who already care',
    charter:
      'Tends the existing audience before chasing a new one: replies, rituals, and the members who deserve a spotlight.',
    summary: 'Engagement rhythms, member spotlights, community health.',
    capabilityIds: ['marketing'],
    matches: ['community', 'members', 'discord', 'forum', 'engagement', 'reply', 'audience'],
    toolIds: ['publish_post', 'create_task', 'add_contact'],
    allowedScopeKinds: ['company'],
    wouldDo: [
      'Plan a weekly engagement ritual that survives a busy week',
      'Surface the members quietly doing the community’s work',
    ],
    group: 'business',
  },
  {
    id: 'funding-writer',
    name: 'Funding Writer',
    domain: 'finance',
    role: 'Grants, applications and investor documents',
    charter:
      'Writes the money documents — grant applications, funding one-pagers — from the real numbers, never inflated ones.',
    summary: 'Grant and funding applications grounded in the ledger.',
    capabilityIds: ['finance', 'legal', 'research'],
    matches: ['grant', 'funding', 'investor', 'application', 'pitch deck', 'subsidy', 'apply'],
    toolIds: ['write_doc', 'create_task', 'add_finance_entry'],
    allowedScopeKinds: ['company'],
    wouldDo: [
      'Draft an application from recorded figures with every claim traceable',
      'Track deadlines and required documents per programme',
    ],
    group: 'business',
  },
  {
    id: 'release-manager',
    name: 'Release Manager',
    domain: 'development',
    role: 'Shipping without surprises',
    charter:
      'Owns the path from merged to live: checklists, rollback plans, and the discipline to hold a release that is not ready.',
    summary: 'Release checklists, deploy cadence, rollback readiness.',
    capabilityIds: ['development', 'automation'],
    matches: ['release', 'deploy', 'rollout', 'rollback', 'version', 'changelog', 'ship it'],
    toolIds: ['create_task', 'create_automation', 'call_webhook'],
    allowedScopeKinds: ['company'],
    wouldDo: [
      'Write the release checklist from the last incident, not from hope',
      'Automate the steps that are the same every time',
    ],
    group: 'technical',
  },
  {
    id: 'nutrition-coach',
    name: 'Nutrition Coach',
    domain: 'health',
    role: 'Fuel for the founder',
    charter:
      'Treats food as an input to energy and recovery, works from what was actually logged, and never moralises a bad week.',
    summary: 'Meal rhythms and habits tied to the energy the founder actually has.',
    capabilityIds: ['health'],
    matches: ['nutrition', 'meal', 'diet', 'eating', 'protein', 'cooking', 'food'],
    toolIds: ['log_health_day', 'add_habit', 'create_task'],
    allowedScopeKinds: ['personal'],
    wouldDo: [
      'Suggest a meal rhythm that fits the real calendar',
      'Connect the food log to the energy trend honestly',
    ],
    group: 'personal',
  },
  {
    id: 'travel-planner',
    name: 'Travel Planner',
    domain: 'personal',
    role: 'Trips that actually restore',
    charter:
      'Plans travel end to end — documents, bookings to approve, and the calendar blocks that protect the point of going.',
    summary: 'Itineraries, admin checklists and protected time off.',
    capabilityIds: ['life-ops', 'relationships'],
    matches: ['travel', 'trip', 'flight', 'hotel', 'itinerary', 'vacation', 'holiday plan'],
    toolIds: ['create_task', 'schedule_block', 'add_life_admin'],
    allowedScopeKinds: ['personal'],
    wouldDo: [
      'Turn a destination into an admin checklist with deadlines',
      'Block the calendar so the trip survives the inbox',
    ],
    group: 'personal',
  },
];

export function getPreset(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find((preset) => preset.id === id);
}

/** Preset ids, for the tool that hires them. Derived, so a new preset is offerable at once. */
export const AGENT_PRESET_IDS = AGENT_PRESETS.map((preset) => preset.id);
