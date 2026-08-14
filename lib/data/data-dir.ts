import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where OmniOS keeps its data, resolved in one place.
 *
 * This existed as two private copies (fs-store, vault) that had to agree; now
 * it cannot drift. `OMNIOS_DATA_DIR` always wins. On a real machine the default
 * is `.omnios-data` beside the app, which is the product: files a founder can
 * read, back up and delete.
 *
 * On a serverless runtime (Vercel, Lambda) the working directory is a read-only
 * code snapshot — `mkdir .omnios-data` was the entire cause of the deployed
 * 500s — and the only writable path is the instance's temp dir. That storage
 * evaporates on every cold start, which is why `isEphemeralDataDir` exists:
 * the shell shows an honest banner instead of letting a preview masquerade as
 * a place data survives.
 */
function isServerlessRuntime(): boolean {
  return process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
}

export function dataDir(): string {
  const configured = process.env.OMNIOS_DATA_DIR?.trim();
  if (configured) return resolve(configured);
  if (isServerlessRuntime()) return join(tmpdir(), 'omnios-data');
  return resolve(process.cwd(), '.omnios-data');
}

export function isEphemeralDataDir(): boolean {
  return !process.env.OMNIOS_DATA_DIR?.trim() && isServerlessRuntime();
}
