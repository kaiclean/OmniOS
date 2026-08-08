import 'server-only';

/**
 * The secret vault.
 *
 * AES-256-GCM, one random IV per secret, authentication tag stored alongside so a
 * tampered file fails to decrypt rather than silently returning garbage.
 *
 * The key comes from `OMNIOS_SECRET_KEY` when set. Otherwise one is generated on
 * first use and written to `.omnios-data/.secret-key` with mode 0600. That is a
 * deliberate, stated trade-off: it makes the vault work with zero setup, and it
 * means the key sits on the same disk as the ciphertext. It defends against a
 * secret leaking through a synced folder, a backup, a screenshot or an accidental
 * commit. It does not defend against someone holding your unlocked machine. The
 * Settings page says exactly this, because a vault that oversells itself is worse
 * than no vault at all.
 *
 * Plaintext exists only inside this module and inside a tool executor at the
 * moment of use. It is never returned to a page, never written to a ToolCall,
 * never placed in agent context, and never sent to a model.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { EncryptedSecret, SecretKind, SecretMeta, SecretVaultFile } from '@/lib/domain';
import { isValidSecretName, referencedSecretNames } from '@/lib/domain';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

function dataDir(): string {
  const configured = process.env.OMNIOS_DATA_DIR?.trim();
  return configured ? resolve(configured) : resolve(process.cwd(), '.omnios-data');
}

const vaultPath = (): string => join(dataDir(), 'secrets.json');
const keyPath = (): string => join(dataDir(), '.secret-key');

let cachedKey: Buffer | null = null;

async function loadKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.OMNIOS_SECRET_KEY?.trim();
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `OMNIOS_SECRET_KEY must be ${KEY_BYTES} bytes of base64 (got ${key.length}). Generate one with: openssl rand -base64 32`,
      );
    }
    cachedKey = key;
    return key;
  }

  const path = keyPath();
  try {
    const existing = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64');
    if (existing.length === KEY_BYTES) {
      cachedKey = existing;
      return existing;
    }
    throw new Error(
      `The key file at ${path} is malformed. Move it aside — note that every stored secret becomes unreadable and must be re-entered.`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const generated = randomBytes(KEY_BYTES);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, generated.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
  cachedKey = generated;
  return generated;
}

async function readVault(): Promise<SecretVaultFile> {
  try {
    const parsed = JSON.parse(await readFile(vaultPath(), 'utf8')) as SecretVaultFile;
    if (!Array.isArray(parsed.secrets)) throw new SyntaxError('secrets is not an array');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, algorithm: ALGORITHM, secrets: [] };
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        'The secret vault file is corrupt. Move .omnios-data/secrets.json aside and re-enter your secrets.',
      );
    }
    throw error;
  }
}

/**
 * One promise chain for the vault file — the same guard `fs-store.ts` puts on a
 * scope file, and load-bearing here in a way that is easy to miss.
 *
 * `revealSecret` *writes* on every read, to bump `lastUsedAt`. So two concurrent
 * reads are two concurrent writes, both to `secrets.json.<pid>.tmp` — one temp
 * name, one process. Whichever renamed first won and the other threw ENOENT on
 * `chmod`. `apiKey()` swallows that, so the symptom was the assistant reporting
 * no API key on a workspace that had one, intermittently, under load.
 */
let vaultWrites: Promise<unknown> = Promise.resolve();

function serialiseVaultWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = vaultWrites.then(work, work);
  vaultWrites = next.catch(() => undefined);
  return next;
}

async function writeVault(file: SecretVaultFile): Promise<void> {
  await serialiseVaultWrite(async () => {
    const path = vaultPath();
    await mkdir(dirname(path), { recursive: true });
    // Unique per write, not just per process. The promise queue above serialises
    // writes *within one module instance*, and Next instantiates a module once
    // per graph — `app-rsc` and `app-ssr` each get their own copy, so each gets
    // its own queue and they race with each other under one pid. Observed as
    // ENOENT on chmod, swallowed by `apiKey()` into "no API key configured".
    const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, path);
  });
}

function encrypt(plaintext: string, key: Buffer): Pick<EncryptedSecret, 'cipher' | 'iv' | 'tag'> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    cipher: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(record: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.cipher, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

const meta = (record: EncryptedSecret): SecretMeta => {
  const { cipher: _c, iv: _i, tag: _t, ...rest } = record;
  return rest;
};

/* ------------------------------------------------------------- public ----- */

/**
 * A purpose-separated subkey derived from the workspace key.
 *
 * Exists so a feature that needs to sign something — a Telegram approval button,
 * say — does not require the founder to configure and store yet another secret,
 * and does not reuse the encryption key directly for a second job. Two purposes
 * yield two unrelated keys, so a signing key that leaked could not decrypt the
 * vault, and the derivation is deterministic so signatures survive a restart.
 *
 * Returns key *material*, never a stored secret: nothing here reads or writes
 * `secrets.json`.
 */
export async function deriveSubkey(purpose: string): Promise<string> {
  const key = await loadKey();
  return createHmac('sha256', key).update(`omnios:subkey:${purpose}`).digest('base64url');
}

/** Metadata for every secret. Never includes any part of a value. */
export async function listSecrets(): Promise<SecretMeta[]> {
  const vault = await readVault();
  return vault.secrets.map(meta).sort((a, b) => a.name.localeCompare(b.name));
}

export async function hasSecret(name: string): Promise<boolean> {
  const vault = await readVault();
  return vault.secrets.some((s) => s.name === name);
}

export interface PutSecretInput {
  readonly name: string;
  readonly value: string;
  readonly kind: SecretKind;
  readonly description?: string;
  readonly capabilityId?: string;
}

export async function putSecret(input: PutSecretInput): Promise<SecretMeta> {
  if (!isValidSecretName(input.name)) {
    throw new Error('A secret name may contain letters, numbers, dot, dash and underscore only.');
  }
  if (!input.value) throw new Error('A secret needs a value.');

  const key = await loadKey();
  const vault = await readVault();
  const now = new Date().toISOString();
  const existing = vault.secrets.find((s) => s.name === input.name);

  const record: EncryptedSecret = {
    name: input.name,
    kind: input.kind,
    description: input.description ?? '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.lastUsedAt ? { lastUsedAt: existing.lastUsedAt } : {}),
    useCount: existing?.useCount ?? 0,
    // Enough to recognise which key this is, not enough to be worth stealing.
    hint: input.value.length >= 8 ? `…${input.value.slice(-4)}` : '…',
    ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
    ...encrypt(input.value, key),
  };

  await writeVault({
    ...vault,
    secrets: [...vault.secrets.filter((s) => s.name !== input.name), record],
  });
  return meta(record);
}

export async function deleteSecret(name: string): Promise<boolean> {
  const vault = await readVault();
  if (!vault.secrets.some((s) => s.name === name)) return false;
  await writeVault({ ...vault, secrets: vault.secrets.filter((s) => s.name !== name) });
  return true;
}

/**
 * Decrypt one secret.
 *
 * The only function in the codebase that returns plaintext. Every caller is a
 * tool executor resolving a placeholder at the point of use, or the founder
 * explicitly revealing a value in Settings. Nothing else should import it —
 * `resolveSecrets` below is the interface the tool layer actually uses.
 */
export async function revealSecret(name: string): Promise<string | null> {
  const vault = await readVault();
  const record = vault.secrets.find((s) => s.name === name);
  if (!record) return null;

  const key = await loadKey();
  let plaintext: string;
  try {
    plaintext = decrypt(record, key);
  } catch {
    throw new Error(
      `"${name}" could not be decrypted. Either the key changed or the vault was modified outside OmniOS.`,
    );
  }

  await writeVault({
    ...vault,
    secrets: vault.secrets.map((s) =>
      s.name === name ? { ...s, lastUsedAt: new Date().toISOString(), useCount: s.useCount + 1 } : s,
    ),
  });
  return plaintext;
}

/**
 * Substitute `{{secret:NAME}}` placeholders.
 *
 * This is what a `ToolContext` hands executors. The input string is whatever was
 * persisted on the ToolCall — placeholders intact — and the output exists only
 * for the duration of the call. An unknown name is left as-is rather than
 * replaced with an empty string, so a typo surfaces as a visible failure instead
 * of a request silently sent without credentials.
 */
export async function resolveSecrets(value: string): Promise<string> {
  const names = referencedSecretNames(value);
  if (names.length === 0) return value;

  let out = value;
  for (const name of names) {
    const plaintext = await revealSecret(name);
    if (plaintext === null) continue;
    out = out.split(`{{secret:${name}}}`).join(plaintext);
  }
  return out;
}

/** Every stored plaintext, for the redaction pass. Never leaves the server. */
export async function allSecretValues(): Promise<string[]> {
  const vault = await readVault();
  if (vault.secrets.length === 0) return [];
  const key = await loadKey();
  const values: string[] = [];
  for (const record of vault.secrets) {
    try {
      values.push(decrypt(record, key));
    } catch {
      // A secret that cannot be decrypted also cannot have leaked into this text.
    }
  }
  return values;
}

export interface VaultStatus {
  readonly count: number;
  readonly keySource: 'environment' | 'generated file';
  readonly location: string;
  readonly algorithm: string;
}

export async function vaultStatus(): Promise<VaultStatus> {
  const vault = await readVault();
  return {
    count: vault.secrets.length,
    keySource: process.env.OMNIOS_SECRET_KEY?.trim() ? 'environment' : 'generated file',
    location: vaultPath(),
    algorithm: 'AES-256-GCM',
  };
}

/** Constant-time comparison, for any future unlock flow. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
