/**
 * The generation context and the small helpers every company generator shares.
 *
 * No randomness of its own: the seeded `Rng` arrives through `GenCtx`.
 */

import { companyScope, makeRecordId, type CompanyDraft } from '@/lib/domain';
import type { Rng } from '../rng';

export interface GenCtx {
  readonly rng: Rng;
  readonly companyId: string;
  readonly now: Date;
  readonly draft: CompanyDraft;
}

export const iso = (d: Date): string => d.toISOString();
export const dayOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

export function base(ctx: GenCtx, kind: string, seed: string) {
  return {
    id: makeRecordId(kind, `${ctx.companyId}:${seed}`),
    scope: companyScope(ctx.companyId),
    createdAt: iso(ctx.now),
    updatedAt: iso(ctx.now),
  };
}
