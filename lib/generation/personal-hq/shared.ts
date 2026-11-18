/**
 * The seed and the small helpers every personal-life generator shares.
 */

import { makeRecordId, personalScope } from '@/lib/domain';

export const SEED = 'personal:v1';

export const iso = (d: Date): string => d.toISOString();
export const dayOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

export function base(kind: string, seed: string, now: Date) {
  return {
    id: makeRecordId(kind, `personal:${seed}`),
    scope: personalScope(),
    createdAt: iso(now),
    updatedAt: iso(now),
  };
}
