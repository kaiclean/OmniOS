import 'server-only';

/**
 * Helpers every executor group uses: outcome constructors, deterministic ids,
 * and tolerant argument readers.
 *
 * Nothing here touches the store or decides anything. The approval gate is not
 * in this directory at all; it lives in `../executors.ts` (`runTool`), so a
 * helper added here cannot become a second, divergent copy of it.
 */

import {
  makeRecordId,
  scopeKey,
  type Timestamp,
  type ToolArgs,
  type ToolContext,
  type ToolOutcome,
} from '@/lib/domain';
import { capabilitiesFor } from '@/lib/capabilities/registry';
import { argText } from '../index';

/* ------------------------------------------------------------- helpers ---- */

export const ok = (summary: string, affectedIds: readonly string[] = []): ToolOutcome => ({
  ok: true,
  summary,
  affectedIds,
});

export const refuse = (summary: string, error: string): ToolOutcome => ({
  ok: false,
  summary,
  error,
  affectedIds: [],
});

/** A shared capability scope holds generalised lessons, never runnable records. */
export function spaceKindOf(ctx: ToolContext): 'company' | 'personal' | null {
  return ctx.scope.kind === 'shared' ? null : ctx.scope.kind;
}

export const stampOf = (ctx: ToolContext): Timestamp => ctx.now.toISOString();
export const dayOf = (ctx: ToolContext): string => ctx.now.toISOString().slice(0, 10);

/**
 * Ids are derived from scope, time and content rather than randomness, so the
 * same call in a test produces the same id every run. The call id (unique per
 * proposed call, sequence included) is mixed in so two same-titled creations
 * within one frozen-clock turn cannot collide — see ToolContext.callId.
 */
export function newId(ctx: ToolContext, prefix: string, seed: string): string {
  return makeRecordId(prefix, `${scopeKey(ctx.scope)}:${stampOf(ctx)}:${ctx.callId ?? ''}:${seed}`);
}

export function base(ctx: ToolContext, prefix: string, seed: string) {
  const at = stampOf(ctx);
  return { id: newId(ctx, prefix, seed), scope: ctx.scope, createdAt: at, updatedAt: at };
}

export function optText(args: ToolArgs, name: string): string | undefined {
  const value = argText(args, name);
  return value === '' ? undefined : value;
}

export function enumArg<T extends string>(args: ToolArgs, name: string, allowed: readonly T[], fallback: T): T {
  const raw = argText(args, name);
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function optEnum<T extends string>(args: ToolArgs, name: string, allowed: readonly T[]): T | undefined {
  const raw = argText(args, name);
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export const listArg = (args: ToolArgs, name: string): string[] =>
  argText(args, name, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

/** 0..1 values arrive from models as anything. Clamp rather than store nonsense. */
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function capabilityFor(ctx: ToolContext, args: ToolArgs, fallback: string): string {
  const kind = spaceKindOf(ctx);
  const requested = argText(args, 'capabilityId', fallback);
  if (!kind) return fallback;
  // A capability that does not apply to this space kind would file the record
  // somewhere no page in this space ever renders.
  return capabilitiesFor(kind).some((c) => c.id === requested) ? requested : fallback;
}

export const missing = (what: string): ToolOutcome =>
  refuse(`${what} is not in this space.`, `${what} could not be found in this scope.`);
