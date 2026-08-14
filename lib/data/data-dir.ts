import 'server-only';

import { accessSync, constants, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * Where OmniOS keeps its data, resolved in one place.
 *
 * This existed as two private copies (fs-store, vault) that had to agree; now
 * it cannot drift. `OMNIOS_DATA_DIR` always wins — configured storage is the
 * founder's own decision. Otherwise the default is `.omnios-data` beside the
 * app, which is the product: files a founder can read, back up and delete.
 *
 * When that directory cannot be created or written — a serverless deployment,
 * where the working directory is a read-only code snapshot and `mkdir
 * .omnios-data` was the entire cause of the deployed 500s — the store falls
 * back to the instance's temp dir rather than crashing every page. The check
 * probes the filesystem instead of sniffing VERCEL/AWS env vars deliberately:
 * `vercel dev` and `vercel env pull` leak VERCEL=1 onto real machines with
 * real disks, and an env-based switch would have silently moved a founder's
 * workspace — and their vault — to /tmp. Writability is the fact that matters,
 * so writability is what gets tested.
 *
 * Temp storage evaporates and warm instances do not share it, which is why
 * `isEphemeralDataDir` exists: the shell shows an honest banner instead of
 * letting a preview masquerade as a place data survives. A configured dir that
 * itself lives under the temp root is labelled the same — pointing
 * OMNIOS_DATA_DIR at /tmp must not buy silence while writes still evaporate.
 */
interface ResolvedDataDir {
  readonly dir: string;
  readonly ephemeral: boolean;
}

let resolved: ResolvedDataDir | null = null;

function underTempRoot(dir: string): boolean {
  const tmp = resolve(tmpdir());
  return dir === tmp || dir.startsWith(tmp + sep);
}

function probe(): ResolvedDataDir {
  const configured = process.env.OMNIOS_DATA_DIR?.trim();
  if (configured) {
    const dir = resolve(configured);
    return { dir, ephemeral: underTempRoot(dir) };
  }

  const local = resolve(process.cwd(), '.omnios-data');
  try {
    mkdirSync(local, { recursive: true });
    accessSync(local, constants.W_OK);
    return { dir: local, ephemeral: false };
  } catch {
    // A full disk lands in the branch above (the dir exists, W_OK holds, the
    // write itself fails loudly later) — only a dir that cannot exist at all
    // reroutes here. That distinction keeps a struggling real machine from
    // silently writing to storage that will not survive a reboot.
    return { dir: join(tmpdir(), 'omnios-data'), ephemeral: true };
  }
}

/** Probed once per process: the answer cannot change without a redeploy. */
function resolveDataDir(): ResolvedDataDir {
  if (!resolved) resolved = probe();
  return resolved;
}

export function dataDir(): string {
  return resolveDataDir().dir;
}

export function isEphemeralDataDir(): boolean {
  return resolveDataDir().ephemeral;
}

/** Tests vary the environment per case; nothing else may clear the cache. */
export function resetDataDirForTests(): void {
  resolved = null;
}
