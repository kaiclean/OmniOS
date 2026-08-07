/**
 * Secrets.
 *
 * A founder's OS accumulates credentials — API keys, tokens, account numbers. The
 * design rule here is that a secret's *value* has exactly one path in and one path
 * out, and neither goes anywhere near the assistant.
 *
 * What is stored: an encrypted blob on disk, plus metadata (name, description,
 * when it was last used) that is safe to render.
 * What is never stored: the plaintext, anywhere, at any point, including in
 * ToolCall records, memory, agent runs, or logs.
 * What the assistant sees: the *names* only. A tool parameter may carry
 * `{{secret:STRIPE_KEY}}`, and the placeholder is substituted inside the executor
 * at the moment of use — after the ToolCall has already been persisted with the
 * placeholder intact.
 *
 * Threat model, stated plainly because a vault that oversells itself is worse
 * than none: this protects against a secret being read out of a synced folder, a
 * backup, a screenshot, or an accidental commit. It does not protect against
 * someone who already has your unlocked machine, because the key lives on the
 * same disk. That is the honest trade for a local-first system with no server.
 */

import type { Timestamp } from './work';

export const SECRET_KINDS = [
  'api-key',
  'token',
  'password',
  'connection-string',
  'account-number',
  'note',
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Safe to render anywhere. Contains no part of the secret itself. */
export interface SecretMeta {
  readonly name: string;
  readonly kind: SecretKind;
  readonly description: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly lastUsedAt?: Timestamp;
  readonly useCount: number;
  /** Last four characters, for recognising which key this is without revealing it. */
  readonly hint: string;
  /** Which capability tends to use it — purely organisational. */
  readonly capabilityId?: string;
}

/** The on-disk shape. `cipher`, `iv` and `tag` are base64. */
export interface EncryptedSecret extends SecretMeta {
  readonly cipher: string;
  readonly iv: string;
  readonly tag: string;
}

export interface SecretVaultFile {
  readonly version: 1;
  readonly algorithm: 'aes-256-gcm';
  readonly secrets: EncryptedSecret[];
}

/** `{{secret:NAME}}` — the only form the assistant ever handles. */
export const SECRET_PLACEHOLDER = /\{\{secret:([A-Za-z0-9_.-]{1,64})\}\}/g;

export function referencedSecretNames(value: string): string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(SECRET_PLACEHOLDER)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

export function isValidSecretName(name: string): boolean {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(name);
}

/**
 * Scrub known secret values out of a string before it is persisted or shown.
 *
 * Belt and braces: nothing should ever put a plaintext secret into a log line,
 * but if something does, this is the last place it can be caught. Short values
 * are skipped — redacting a three-character secret would redact half the text
 * and reveal more by its absence than it hides.
 */
export function redact(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of values) {
    if (value.length < 8) continue;
    out = out.split(value).join('••••redacted••••');
  }
  return out;
}
