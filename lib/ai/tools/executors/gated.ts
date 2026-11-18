import 'server-only';

/**
 * The two gated tiers: `destructive` (delete a record, reset a capability) and
 * `external` (declared but not wired).
 *
 * These executors do not check approval themselves, and that is deliberate: the
 * check exists once, in `runTool`, so there is no second copy to drift. What
 * they do own is refusing honestly — the `external` ones refuse before touching
 * `ctx.resolveSecrets`, so a call that cannot happen never decrypts a credential.
 */

import type { ToolExecutor } from '@/lib/domain';
import type { ScopeData } from '@/lib/data/schema';
import { mutateScope, readCollection, removeRecord } from '@/lib/data/store';
import { capabilitiesFor } from '@/lib/capabilities/registry';
import {
  CAPABILITY_SCOPED_COLLECTIONS,
  DELETABLE_COLLECTIONS,
  argText,
  type DeletableCollection,
} from '../index';
import { ok, refuse, spaceKindOf, missing } from './shared';

export const deleteRecord: ToolExecutor = async (ctx, args) => {
  const collection = argText(args, 'collection') as DeletableCollection;
  if (!(DELETABLE_COLLECTIONS as readonly string[]).includes(collection)) {
    return refuse(
      `${collection} cannot be deleted from.`,
      'That collection is part of the audit trail and is not deletable.',
    );
  }
  const recordId = argText(args, 'recordId');
  const records: ReadonlyArray<{ id: string }> = await readCollection(ctx.scope, collection);
  if (!records.some((record) => record.id === recordId)) return missing(`Record ${recordId}`);

  await removeRecord(ctx.scope, collection, recordId);
  return ok(`Deleted ${recordId} from ${collection}. This cannot be undone.`, [recordId]);
};

export const resetCapabilityData: ToolExecutor = async (ctx, args) => {
  const kind = spaceKindOf(ctx);
  if (!kind) return refuse('Not a resettable scope.', 'Shared capability memory holds no runnable records.');

  const capabilityId = argText(args, 'capabilityId');
  if (!capabilitiesFor(kind).some((c) => c.id === capabilityId)) {
    return refuse(`${capabilityId} is not a capability of this space.`, 'Unknown capability.');
  }

  const removed: string[] = [];
  await mutateScope(ctx.scope, (data) => {
    const next: ScopeData = { ...data };
    // One predicate over ten differently-typed collections. The cast is the price
    // of not writing the same three lines ten times; every collection listed is
    // checked against `CollectionName` where the list is declared.
    const bag = next as unknown as Record<string, Array<{ id: string; capabilityId?: string }>>;
    for (const name of CAPABILITY_SCOPED_COLLECTIONS) {
      const before = bag[name] ?? [];
      for (const record of before) {
        if (record.capabilityId === capabilityId) removed.push(record.id);
      }
      bag[name] = before.filter((record) => record.capabilityId !== capabilityId);
    }
    return next;
  });

  return ok(
    `Deleted ${removed.length} ${capabilityId} record${removed.length === 1 ? '' : 's'} across ${CAPABILITY_SCOPED_COLLECTIONS.length} collections. The evolution log was left intact. This cannot be undone.`,
    removed,
  );
};

/* -------------------------------------------------------------- external -- */

/**
 * V1 wires no outbound provider.
 *
 * These executors refuse rather than simulating success, and they refuse *before*
 * touching `ctx.resolveSecrets` — a call that will not happen has no reason to
 * decrypt a credential. The tools exist so the approval path is real: the gate,
 * the preview, the recorded decision and the refusal are all exercised end to end.
 */
/**
 * Tools that exist to prove the gate and refuse to act.
 *
 * Exported so the assistant can be told not to offer them. A capability the
 * system lists but cannot perform is worse than one it never mentions.
 */
export const NOT_WIRED_TOOL_IDS = ['send_email', 'publish_post', 'call_webhook'] as const;

export function notWired(what: string, provider: string): ToolExecutor {
  return async () => ({
    ok: false,
    summary: `Refused: ${what} was approved but not performed.`,
    error: `No ${provider} is wired in this build. OmniOS will not claim to have done something it did not do. Nothing left this machine, and no credential was decrypted.`,
    affectedIds: [],
  });
}
