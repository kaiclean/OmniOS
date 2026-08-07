'use server';

import { revalidatePath } from 'next/cache';

import type { MemoryKind, MemoryRecord, Scope } from '@/lib/domain';
import {
  MEMORY_KINDS,
  makeRecordId,
  parseScopeKey,
  promotionCheck,
  scopeKey,
  sharedScope,
} from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import { getWorkspace, insertRecords, readScope, removeRecord } from '@/lib/data/store';

/**
 * Memory promotion — the one path by which anything crosses a scope boundary.
 *
 * Everything here exists to make that crossing hard. The gate is
 * `promotionCheck`, it runs on the server against the text as submitted, and a
 * refusal returns the violations rather than a generic failure: the founder has
 * to be able to see *why* a lesson was rejected, or they will assume the check
 * is theatre.
 */

export interface PromotionOutcome {
  readonly ok: boolean;
  /** Reasons the gate refused. Empty on success and on operational errors. */
  readonly violations: readonly string[];
  readonly error?: string;
  readonly capabilityId?: string;
  readonly text?: string;
}

const refused = (violations: readonly string[]): PromotionOutcome => ({ ok: false, violations });
const failed = (error: string): PromotionOutcome => ({ ok: false, violations: [], error });

/**
 * A fact is true of one space; it cannot be true of every space. Only the kinds
 * that describe *how things behave* are allowed through, which is why the shared
 * kind is chosen at promotion time rather than inherited from the source record.
 */
const PROMOTABLE_KINDS: readonly MemoryKind[] = MEMORY_KINDS.filter((kind) => kind !== 'fact');

function isPromotableKind(value: string): value is MemoryKind {
  return (PROMOTABLE_KINDS as readonly string[]).includes(value);
}

/**
 * The terms that would give away where a lesson came from.
 *
 * Company names and the founder's own name always count. Counterparties from the
 * source scope are included only from five characters up: `promotionCheck` does a
 * substring match, so a three-letter contact name would flag half the dictionary
 * and train the founder to click past the gate — which is worse than not having it.
 */
async function identifyingTerms(scope: Scope): Promise<string[]> {
  const workspace = await getWorkspace();
  const terms = [
    ...workspace.companies.map((company) => company.name),
    workspace.personal.displayName,
  ];

  const data = await readScope(scope);
  for (const contact of data.contacts) {
    terms.push(contact.name, contact.organisation ?? '');
  }
  for (const entry of data.finance) {
    terms.push(entry.counterparty ?? '');
  }
  for (const person of data.relationships) {
    terms.push(person.name);
  }

  return [...new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 5))];
}

/** Resolves a scope key from the browser to a scope a record may be promoted *from*. */
function sourceScope(key: string): Scope | null {
  const scope = parseScopeKey(key);
  // Shared scopes are the destination, never the origin: promotion is one-way,
  // and re-promoting shared memory would let a lesson launder itself sideways.
  return !scope || scope.kind === 'shared' ? null : scope;
}

/**
 * Runs the gate without writing anything.
 *
 * Exists so the founder can rewrite a refused lesson until it passes, and see the
 * refusal change as they edit, instead of discovering the rule by trial and error.
 */
export async function checkPromotion(
  sourceScopeKey: string,
  text: string,
): Promise<{ allowed: boolean; violations: readonly string[] }> {
  const scope = sourceScope(sourceScopeKey);
  if (!scope) return { allowed: false, violations: ['That is not a scope a lesson can come from.'] };
  return promotionCheck(text, await identifyingTerms(scope));
}

export async function promoteMemory(
  sourceScopeKey: string,
  recordId: string,
  text: string,
  kind: string,
): Promise<PromotionOutcome> {
  const scope = sourceScope(sourceScopeKey);
  if (!scope) return failed('That is not a scope a lesson can be promoted from.');
  if (!isPromotableKind(kind)) {
    return refused([
      'a fact describes one space and cannot generalise — rewrite it as a lesson, pattern, decision, preference or style',
    ]);
  }

  const data = await readScope(scope);
  const record = data.memory.find((entry) => entry.id === recordId);
  if (!record) return failed('That record no longer exists in this scope.');

  const candidate = text.trim() || record.text;
  if (candidate.length < 12) return failed('Too short to be a lesson another space could use.');
  if (candidate.length > 400) return failed('Longer than shared memory accepts. Cut it down.');

  const verdict = promotionCheck(candidate, await identifyingTerms(scope));
  if (!verdict.allowed) return refused(verdict.violations);

  const target = sharedScope(record.capabilityId);
  const existing = await readScope(target);
  const normalised = candidate.toLowerCase();
  if (existing.memory.some((entry) => entry.text.trim().toLowerCase() === normalised)) {
    return failed('Shared memory already holds that lesson.');
  }

  const now = new Date().toISOString();
  const promoted: MemoryRecord = {
    id: makeRecordId('mem', `${scopeKey(scope)}:${recordId}:${candidate}`),
    scope: target,
    createdAt: now,
    updatedAt: now,
    kind,
    text: candidate,
    capabilityId: record.capabilityId,
    // Carried over rather than adjusted. Nothing in OmniOS reinforces or decays
    // strength yet, so a promotion-time discount would be a number nobody computed.
    strength: record.strength,
    tags: [...new Set([...record.tags, 'promoted'])],
    source: 'founder',
    useCount: 0,
    promotedFromScopeKey: scopeKey(scope),
  };

  await insertRecords(target, 'memory', [promoted]);
  revalidatePath('/', 'layout');
  return { ok: true, violations: [], capabilityId: record.capabilityId, text: candidate };
}

export interface ForgetOutcome {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Removes a record from shared memory.
 *
 * Shared memory is the only store every space reads, so a wrong lesson there is
 * wrong everywhere. Being able to delete one is part of the same promise as the
 * gate that admits it.
 */
export async function forgetSharedMemory(
  capabilityId: string,
  recordId: string,
): Promise<ForgetOutcome> {
  if (!capabilityIds().includes(capabilityId)) {
    return { ok: false, error: 'That is not a capability this workspace runs.' };
  }

  const scope = sharedScope(capabilityId);
  const data = await readScope(scope);
  if (!data.memory.some((entry) => entry.id === recordId)) {
    return { ok: false, error: 'That record is no longer in shared memory.' };
  }

  await removeRecord(scope, 'memory', recordId);
  revalidatePath('/', 'layout');
  return { ok: true };
}
