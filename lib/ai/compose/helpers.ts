/**
 * What every composer shares: the `Composition` shape, ordering weights, and the
 * small readers and text builders that keep every answer grounded in records.
 */

import type { DateOnly, Task } from '@/lib/domain';
import { deepWorkBudgetMinutes, energyLabel, energyOf } from '@/lib/personal/energy';
import { financeOf, healthOf, tasksOf, type AssistantContext, type Origin } from '../context';
import type { ContextReferenceInput } from '../types';

export interface Composition {
  readonly summary: string;
  readonly body: string;
  readonly references: readonly ContextReferenceInput[];
  readonly outputs: ReadonlyMap<string, string>;
  /**
   * Set when no specialist owned the question and the reply is orientation
   * rather than analysis. The assistant uses it to attach tappable next moves
   * — the founder should never have to type back a menu the reply offered.
   */
  readonly orientation?: true;
}

const PRIORITY_WEIGHT: Record<Task['priority'], number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
export const ENERGY_MINUTES: Record<Task['energy'], number> = { light: 15, moderate: 45, deep: 110 };

/* ------------------------------------------------------------- helpers ---- */

export function ref(kind: string, o: Origin<{ id: string }>, label: string): ContextReferenceInput {
  return { kind, id: o.item.id, label, scopeKey: o.scopeKey };
}

function latestHealth(ctx: AssistantContext) {
  const days = healthOf(ctx)
    .filter((d) => d.item.sleepHours !== undefined)
    .sort((a, b) => (a.item.date < b.item.date ? 1 : -1));
  return days[0];
}

export function energyToday(ctx: AssistantContext): { score: number | null; label: string; budget: number | null } {
  const latest = latestHealth(ctx);
  const score = energyOf(latest?.item);
  return { score, label: energyLabel(score), budget: deepWorkBudgetMinutes(score) };
}

export function openTasks(ctx: AssistantContext): Array<Origin<Task>> {
  return tasksOf(ctx)
    .filter((t) => t.item.status !== 'done')
    .sort((a, b) => {
      const p = PRIORITY_WEIGHT[a.item.priority] - PRIORITY_WEIGHT[b.item.priority];
      if (p !== 0) return p;
      const aDue = a.item.dueDate ?? '9999-12-31';
      const bDue = b.item.dueDate ?? '9999-12-31';
      return aDue < bDue ? -1 : aDue > bDue ? 1 : 0;
    });
}

export function isOverdue(due: DateOnly | undefined, now: Date): boolean {
  return due !== undefined && new Date(due).getTime() < now.getTime();
}

export interface Position {
  readonly inMinor: number;
  readonly outMinor: number;
  readonly netMinor: number;
  readonly currency: 'CHF' | 'EUR' | 'USD' | 'GBP';
  readonly months: number;
}

export function position(ctx: AssistantContext, monthsBack = 3): Position {
  const cutoff = new Date(ctx.now.getTime() - monthsBack * 30 * 86_400_000).toISOString().slice(0, 10);
  const entries = financeOf(ctx).filter(
    (e) => e.item.date >= cutoff && e.item.confidence !== 'forecast',
  );
  let inMinor = 0;
  let outMinor = 0;
  let currency: Position['currency'] = 'CHF';
  for (const { item } of entries) {
    currency = item.amount.currency;
    if (item.direction === 'in') inMinor += item.amount.amount;
    else outMinor += item.amount.amount;
  }
  return { inMinor, outMinor, netMinor: inMinor - outMinor, currency, months: monthsBack };
}

export function bullet(lines: readonly string[]): string {
  return lines.map((l) => `• ${l}`).join('\n');
}

export function section(heading: string, body: string): string {
  return `${heading}\n${body}`;
}

/**
 * Join answer blocks with a blank line between them.
 *
 * Not `.filter(Boolean).join('\n')` — an intentional blank separator is falsy,
 * so that idiom silently collapsed every section heading onto the line above it.
 */
export function blocks(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n');
}

export type Composer = (ctx: AssistantContext, prompt: string) => Composition;
