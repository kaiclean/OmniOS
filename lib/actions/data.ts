'use server';

import { revalidatePath } from 'next/cache';

import type { Scope } from '@/lib/domain';
import { parseScopeKey, scopeKey } from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import { parseCollectionInput } from '@/lib/data/edit';
import { getWorkspace, mutateScope } from '@/lib/data/store';

/**
 * The direct data editor's one mutation.
 *
 * OmniOS normally changes records through purpose-built actions, but the founder
 * owns their data outright, so Settings offers a raw door: replace one collection
 * in one scope with pasted JSON. The scope posted by the browser is never
 * trusted as-is — it is parsed and then resolved against what actually exists
 * (this company, this capability), so an invented key cannot conjure a new
 * partition. Validation is structural (`parseCollectionInput`): the editor is a
 * power tool, and pretending it can verify domain semantics would be dishonest.
 */

async function resolveScope(scopeKeyInput: string): Promise<Scope | null> {
  const scope = parseScopeKey(scopeKeyInput);
  if (!scope) return null;
  if (scope.kind === 'personal') return scope;
  if (scope.kind === 'shared') {
    return capabilityIds().includes(scope.capabilityId) ? scope : null;
  }
  const workspace = await getWorkspace();
  return workspace.companies.some((company) => company.id === scope.companyId) ? scope : null;
}

export interface DataEditorState {
  readonly ok: boolean;
  readonly message?: string;
}

export async function saveCollectionData(
  _previous: DataEditorState,
  form: FormData,
): Promise<DataEditorState> {
  const scopeInput = form.get('scope');
  const collectionInput = form.get('collection');
  const jsonInput = form.get('json');
  if (typeof scopeInput !== 'string' || typeof collectionInput !== 'string' || typeof jsonInput !== 'string') {
    return { ok: false, message: 'The form arrived incomplete. Nothing was changed.' };
  }

  const scope = await resolveScope(scopeInput);
  if (!scope) {
    return { ok: false, message: 'That scope does not exist. Nothing was changed.' };
  }

  const parsed = parseCollectionInput(collectionInput, jsonInput);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  await mutateScope(scope, (data) => ({
    ...data,
    [parsed.collection]: parsed.records,
  }));

  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: `Saved ${parsed.records.length} record${parsed.records.length === 1 ? '' : 's'} to ${parsed.collection} in ${scopeKey(scope)}.`,
  };
}
