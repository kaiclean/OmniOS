/**
 * Argument readers and the small formatters every tool preview uses.
 *
 * Data-only like the rest of the catalogue: no store access, no `server-only`.
 * Reading an argument never throws, because a preview for half-filled
 * arguments still has to render.
 */

import { CURRENCIES, type ToolArgs } from '@/lib/domain';
import { EMPTY, formatMinorAmount } from '@/lib/format';

/** Reading an arg never throws: a preview for half-filled arguments still has to render. */
export function argText(args: ToolArgs, name: string, fallback = ''): string {
  const value = args[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

export function argNumber(args: ToolArgs, name: string): number | undefined {
  const value = args[name];
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  return undefined;
}

export function argFlag(args: ToolArgs, name: string): boolean {
  return args[name] === true;
}

/** A number for prose, or an em dash. Never a fabricated zero. */
export function say(value: number | undefined): string {
  return value === undefined ? EMPTY : String(value);
}

export const quoted = (args: ToolArgs, name: string, fallback: string): string =>
  `“${argText(args, name, fallback)}”`;

export const money = (args: ToolArgs): string => {
  const amount = argNumber(args, 'amountMinor');
  if (amount === undefined) return EMPTY;
  return formatMinorAmount(amount, currencyOf(args));
};

export function currencyOf(args: ToolArgs): 'CHF' | 'EUR' | 'USD' | 'GBP' {
  const raw = argText(args, 'currency', 'CHF');
  return (CURRENCIES as readonly string[]).includes(raw)
    ? (raw as 'CHF' | 'EUR' | 'USD' | 'GBP')
    : 'CHF';
}

export const BOTH = ['company', 'personal'] as const;
export const PERSONAL = ['personal'] as const;
