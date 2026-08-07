'use server';

import { revalidatePath } from 'next/cache';

import { SECRET_KINDS, isValidSecretName } from '@/lib/domain';
import type { SecretKind, SecretMeta } from '@/lib/domain';
import { deleteSecret, listSecrets, putSecret, vaultStatus } from '@/lib/secrets/vault';

/**
 * The vault's write surface.
 *
 * There is deliberately no action here that returns a secret's value. Storing
 * one and using one are the only two operations the product needs, and adding a
 * "reveal" action would create a path from an encrypted blob to a browser
 * payload that invariant 6 exists to prevent. `revealSecret` stays inside
 * `lib/secrets/vault.ts`, callable only by an executor building a request.
 *
 * What comes back instead is `SecretMeta`: name, kind, description, last four
 * characters, and how often it has been used.
 */

export interface SecretFormState {
  readonly ok: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly message?: string;
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function saveSecret(
  _previous: SecretFormState,
  form: FormData,
): Promise<SecretFormState> {
  const name = field(form, 'name');
  const value = form.get('value');
  const kindRaw = field(form, 'kind');
  const description = field(form, 'description');
  const capabilityId = field(form, 'capabilityId');

  const errors: Record<string, string> = {};
  if (!isValidSecretName(name)) {
    errors['name'] = 'Letters, numbers, underscore, dot and hyphen only. Up to 64 characters.';
  }
  // Not trimmed: some tokens legitimately end in whitespace-adjacent padding, and
  // silently altering a credential produces a failure nobody can explain.
  if (typeof value !== 'string' || value.length === 0) {
    errors['value'] = 'Paste the value. Nothing is stored without one.';
  }
  const kind: SecretKind = SECRET_KINDS.includes(kindRaw as SecretKind)
    ? (kindRaw as SecretKind)
    : 'api-key';

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: 'Nothing was stored.' };
  }

  await putSecret({
    name,
    value: value as string,
    kind,
    description,
    ...(capabilityId ? { capabilityId } : {}),
  });

  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: `${name} is encrypted on disk. Reference it as {{secret:${name}}} anywhere a credential is asked for.`,
  };
}

export async function forgetSecret(name: string): Promise<void> {
  await deleteSecret(name);
  revalidatePath('/', 'layout');
}

export interface VaultView {
  readonly secrets: readonly SecretMeta[];
  readonly keySource: string;
  readonly location: string;
  readonly algorithm: string;
}

export async function readVaultView(): Promise<VaultView> {
  const [secrets, status] = await Promise.all([listSecrets(), vaultStatus()]);
  return {
    secrets,
    keySource: status.keySource,
    location: status.location,
    algorithm: status.algorithm,
  };
}
