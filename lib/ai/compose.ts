/**
 * The local reasoning engine.
 *
 * When no model provider is configured, OmniOS does not fake a conversation. It
 * runs this instead: real analysis over the founder's actual records, written up
 * deterministically. The numbers in every answer below are read from the store,
 * not invented — which is why the answers are useful before a single API key
 * exists, and why the same code path stays valuable afterwards as the grounding
 * layer beneath a real model.
 *
 * This file routes a question to its composer. The composers live in `./compose/`,
 * grouped by domain; they stay pure functions of the assistant context. Split
 * from one 631-line module; importers are unchanged.
 */

import type { AssistantContext } from './context';
import type { RoutingResult } from './router';
import type { Composer, Composition } from './compose/helpers';
import { composeExecutive, composeGeneral } from './compose/executive';
import { composeHealth, composePersonal } from './compose/life';
import { composeFinance, composeGrowth, composeStrategy } from './compose/business';
import { composeDevelopment, composeOperations } from './compose/work';

export type { Composition } from './compose/helpers';

const BY_DOMAIN: Partial<Record<string, Composer>> = {
  executive: composeExecutive,
  finance: composeFinance,
  health: composeHealth,
  personal: composePersonal,
  strategy: composeStrategy,
  research: composeStrategy,
  sales: composeGrowth,
  marketing: composeGrowth,
  social: composeGrowth,
  branding: composeGrowth,
  operations: composeOperations,
  automation: composeOperations,
  'project-management': composeOperations,
  development: composeDevelopment,
  design: composeDevelopment,
  data: composeFinance,
};

export function compose(ctx: AssistantContext, prompt: string, routing: RoutingResult): Composition {
  // Zero matches means the router fell back to the Chief of Staff because nobody
  // claimed the request — not because the Chief of Staff was the right answer.
  // Replying with today's plan to a question it did not understand would be a
  // non-sequitur, so say so and orient instead.
  if (routing.scores.length === 0) return composeGeneral(ctx, prompt);
  const composer = BY_DOMAIN[routing.lead.domain] ?? composeGeneral;
  return composer(ctx, prompt);
}
