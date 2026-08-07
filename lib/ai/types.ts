/**
 * Shared AI-layer types.
 *
 * Split out so `router.ts` and `context.ts` can reference each other's shapes
 * without an import cycle.
 */

export type { AssistantContext, AssistantTarget, Origin, SpaceSlice } from './context';

export interface ContextReferenceInput {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly scopeKey: string;
}
