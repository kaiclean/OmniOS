import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { redact, referencedSecretNames } from '@/lib/domain/secrets';

/**
 * The vault holds the only plaintext in the system, so it is verified rather
 * than assumed. Each test runs against a throwaway data directory so nothing
 * touches a real workspace.
 */

let dir: string;
let vault: typeof import('@/lib/secrets/vault');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-vault-'));
  process.env.OMNIOS_DATA_DIR = dir;
  delete process.env.OMNIOS_SECRET_KEY;
  vault = await import('@/lib/secrets/vault');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('the secret vault', () => {
  it('round-trips a value through encryption', async () => {
    await vault.putSecret({ name: 'STRIPE_KEY', value: 'sk_live_abcdef123456', kind: 'api-key' });
    expect(await vault.revealSecret('STRIPE_KEY')).toBe('sk_live_abcdef123456');
  });

  /**
   * `revealSecret` bumps `lastUsedAt`, so a read is a write. Without a write
   * queue, two concurrent reads raced on one `secrets.json.<pid>.tmp`: whichever
   * renamed first won, the other threw ENOENT, and `apiKey()` swallowed it into
   * "no API key configured" on a workspace that had one. Sequential reads never
   * reproduce it — the concurrency is the test.
   */
  it('survives concurrent reads, which are concurrent writes', async () => {
    await vault.putSecret({ name: 'RACE_KEY', value: 'race-value-123456', kind: 'api-key' });

    const reads = await Promise.all(
      Array.from({ length: 12 }, () => vault.revealSecret('RACE_KEY')),
    );
    expect(reads).toEqual(Array.from({ length: 12 }, () => 'race-value-123456'));

    expect(await vault.revealSecret('RACE_KEY')).toBe('race-value-123456');
    expect((await vault.listSecrets()).some((entry) => entry.name === 'RACE_KEY')).toBe(true);
  });

  it('never writes the plaintext to disk', async () => {
    await vault.putSecret({ name: 'PLAIN_CHECK', value: 'super-secret-value-9876', kind: 'token' });
    const onDisk = await readFile(join(dir, 'secrets.json'), 'utf8');
    expect(onDisk).not.toContain('super-secret-value-9876');
    expect(onDisk).toContain('PLAIN_CHECK');
  });

  it('keeps cipher material out of the metadata listing', async () => {
    const listed = await vault.listSecrets();
    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) {
      expect(entry).not.toHaveProperty('cipher');
      expect(entry).not.toHaveProperty('iv');
      expect(entry).not.toHaveProperty('tag');
    }
  });

  it('exposes only a last-four hint, never a usable prefix', async () => {
    const entry = (await vault.listSecrets()).find((s) => s.name === 'STRIPE_KEY');
    expect(entry?.hint).toBe('…3456');
    expect(entry?.hint).not.toContain('sk_live');
  });

  it('returns null for a secret that does not exist', async () => {
    expect(await vault.revealSecret('NOPE')).toBeNull();
  });

  it('rejects a malformed name rather than storing it', async () => {
    await expect(
      vault.putSecret({ name: 'bad name!', value: 'x'.repeat(20), kind: 'token' }),
    ).rejects.toThrow(/name/i);
  });

  it('rejects an empty value', async () => {
    await expect(vault.putSecret({ name: 'EMPTY', value: '', kind: 'token' })).rejects.toThrow();
  });

  it('overwrites in place and preserves the original creation time', async () => {
    const first = await vault.putSecret({ name: 'ROTATE', value: 'first-value-here', kind: 'token' });
    const second = await vault.putSecret({ name: 'ROTATE', value: 'second-value-here', kind: 'token' });
    expect(second.createdAt).toBe(first.createdAt);
    expect(await vault.revealSecret('ROTATE')).toBe('second-value-here');
    expect((await vault.listSecrets()).filter((s) => s.name === 'ROTATE')).toHaveLength(1);
  });

  it('counts uses so an unused credential is visible as unused', async () => {
    await vault.putSecret({ name: 'COUNTED', value: 'counted-value-1234', kind: 'token' });
    expect((await vault.listSecrets()).find((s) => s.name === 'COUNTED')?.useCount).toBe(0);
    await vault.revealSecret('COUNTED');
    await vault.revealSecret('COUNTED');
    const after = (await vault.listSecrets()).find((s) => s.name === 'COUNTED');
    expect(after?.useCount).toBe(2);
    expect(after?.lastUsedAt).toBeTruthy();
  });

  it('deletes, and reports whether anything was deleted', async () => {
    await vault.putSecret({ name: 'TEMP', value: 'temporary-value-xyz', kind: 'note' });
    expect(await vault.deleteSecret('TEMP')).toBe(true);
    expect(await vault.deleteSecret('TEMP')).toBe(false);
    expect(await vault.revealSecret('TEMP')).toBeNull();
  });

  it('fails loudly when the ciphertext has been tampered with', async () => {
    await vault.putSecret({ name: 'TAMPER', value: 'authentic-value-42', kind: 'token' });
    const path = join(dir, 'secrets.json');
    const file = JSON.parse(await readFile(path, 'utf8')) as {
      secrets: Array<{ name: string; cipher: string }>;
    };
    const target = file.secrets.find((s) => s.name === 'TAMPER');
    expect(target).toBeDefined();
    if (!target) return;
    // Flip a byte. GCM's auth tag must catch this rather than return garbage.
    const bytes = Buffer.from(target.cipher, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    target.cipher = bytes.toString('base64');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify(file));

    await expect(vault.revealSecret('TAMPER')).rejects.toThrow(/could not be decrypted/i);
  });

  it('resolves placeholders and leaves unknown names visibly intact', async () => {
    await vault.putSecret({ name: 'KNOWN', value: 'resolved-value-777', kind: 'api-key' });
    expect(await vault.resolveSecrets('key={{secret:KNOWN}}')).toBe('key=resolved-value-777');
    // A typo must surface as a visible failure, not a silently empty credential.
    expect(await vault.resolveSecrets('key={{secret:MISSING}}')).toBe('key={{secret:MISSING}}');
    expect(await vault.resolveSecrets('no placeholders here')).toBe('no placeholders here');
  });

  it('reports its own configuration honestly', async () => {
    const status = await vault.vaultStatus();
    expect(status.algorithm).toBe('AES-256-GCM');
    expect(status.keySource).toBe('generated file');
    expect(status.location).toContain(dir);
    expect(status.count).toBeGreaterThan(0);
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(vault.safeEqual('abc', 'abc')).toBe(true);
    expect(vault.safeEqual('abc', 'abd')).toBe(false);
    expect(vault.safeEqual('abc', 'abcdef')).toBe(false);
  });
});

describe('placeholder parsing and redaction', () => {
  it('finds every distinct referenced name', () => {
    expect(referencedSecretNames('{{secret:A}} and {{secret:B}} and {{secret:A}}')).toEqual(['A', 'B']);
    expect(referencedSecretNames('nothing here')).toEqual([]);
  });

  it('scrubs values long enough to be worth scrubbing', () => {
    expect(redact('token is sk_live_abcdef123456 ok', ['sk_live_abcdef123456'])).not.toContain(
      'sk_live_abcdef123456',
    );
  });

  it('leaves short values alone, because redacting them reveals more than it hides', () => {
    expect(redact('the value is abc here', ['abc'])).toBe('the value is abc here');
  });
});
