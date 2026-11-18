/**
 * The tool catalogue.
 *
 * Data only — no store access, no `server-only`, no side effects. That is what
 * lets the same list drive the command palette, the approval sheet, a model's
 * function schema and the tests, without any of them reaching for an executor.
 *
 * Two rules shape every entry:
 *
 * 1. The `risk` tier is the whole gate. `write` touches this workspace and runs.
 *    `destructive` and `external` stop and wait for a recorded human decision —
 *    see {@link requiresApproval}. A tool that would delete something or leave
 *    the machine is never tiered `write` to make it convenient.
 * 2. `preview` is a promise. It states, in one sentence, exactly what the call
 *    would do, and it is rendered *before* anything happens. Approval without a
 *    preview is theatre, so the preview must survive missing arguments rather
 *    than throwing and leaving the founder approving a blank.
 *
 * The entries live in `./registry/`, grouped by what the tool touches. This file
 * concatenates them in their original order and is where `ToolId` and `TOOLS`
 * are derived. Split from one 958-line module; importers are unchanged.
 */

import type { ToolDefinition } from '@/lib/domain';
import { CORE_TOOLS } from './registry/core';
import { BUSINESS_TOOLS } from './registry/business';
import { LIFE_TOOLS } from './registry/life';
import { GATED_TOOLS } from './registry/gated';

export { argText, argNumber, argFlag } from './registry/shared';
export {
  DELETABLE_COLLECTIONS,
  SEARCHABLE_COLLECTIONS,
  CAPABILITY_SCOPED_COLLECTIONS,
  CALENDAR_BLOCK_KINDS,
  type DeletableCollection,
  type CapabilityScopedCollection,
} from './registry/collections';

/* --------------------------------------------------------------- tools ---- */

const TOOL_LIST = [...CORE_TOOLS, ...BUSINESS_TOOLS, ...LIFE_TOOLS, ...GATED_TOOLS] as const;

/**
 * The literal ids, so `executors.ts` can type its table as `Record<ToolId, …>`
 * and a tool declared without an executor fails to compile.
 */
export type ToolId = (typeof TOOL_LIST)[number]['id'];

/**
 * The widened list every consumer reads.
 *
 * `TOOL_LIST` keeps its literal types only long enough to derive {@link ToolId};
 * exporting the narrow tuple would force every caller to reason about 30 distinct
 * object shapes where they only ever want a `ToolDefinition`.
 */
export const TOOLS: readonly ToolDefinition[] = TOOL_LIST;
